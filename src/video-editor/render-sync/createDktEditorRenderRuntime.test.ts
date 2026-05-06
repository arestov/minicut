import { describe, expect, it, vi } from 'vitest'
import { defineShape } from '../../dkt-react-sync/shape/defineShape'
import { createVideoEditorHarness } from '../app/createVideoEditorHarness'
import { createEmptyRegistry } from '../domain/createProject'
import { getActiveProject, getClipIdsForTrack, getTracks } from '../domain/selectors'
import { MemoryWorkerAuthority } from '../worker/memoryWorker'
import { createDktRegistryRenderStore } from './DktRegistryRenderStore'
import type { EditorScope } from './EditorScope'

const flushMicrotasks = async () => {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve()
	}
}

const flushMacrotask = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0))
}

const settleHarness = async () => {
	await flushMicrotasks()
	await flushMacrotask()
	await flushMicrotasks()
}

const bootstrappedHarnesses = new WeakSet<ReturnType<typeof createVideoEditorHarness>>()

const clipShape = defineShape({ attrs: ['sourceClipId', 'name', 'start', 'duration'] })
const trackShape = defineShape({ attrs: ['sourceTrackId', 'name', 'kind'], rels: ['clips'], many: { clips: clipShape } })
const projectShape = defineShape({ attrs: ['sourceProjectId', 'title'], rels: ['tracks'], many: { tracks: trackShape } })
const appShape = defineShape({ rels: ['project'], many: { project: projectShape } })
const rootShape = defineShape({ attrs: ['cursor', 'timelineZoom', 'activeProjectId'], rels: ['pioneer', 'activeProject'], one: { pioneer: appShape, activeProject: projectShape } })

const ensurePageRuntimeBooted = async (harness: ReturnType<typeof createVideoEditorHarness>) => {
	if (!bootstrappedHarnesses.has(harness)) {
		bootstrappedHarnesses.add(harness)
		harness.pageRuntime?.bootstrap({ sessionKey: 'render-sync-test' })
		await settleHarness()
		const rootScope = harness.pageRuntime?.getRootScope()
		if (rootScope) {
			harness.pageRuntime?.mountShape(rootScope, rootShape)
		}
	}
	await settleHarness()
}

const flushHarnessDkt = async (harness: ReturnType<typeof createVideoEditorHarness>) => {
	await Promise.resolve(harness.worker.flushDktSync?.())
	await settleHarness()
}

const waitForInitialProject = async (harness: ReturnType<typeof createVideoEditorHarness>) => {
	await ensurePageRuntimeBooted(harness)
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await settleHarness()
		await flushHarnessDkt(harness)
		if (Object.keys(harness.projects$.projects.get()).length > 0) {
			return
		}
	}

	throw new Error('Timed out waiting for initial project')
}

const waitForActiveProjectScope = async (harness: ReturnType<typeof createVideoEditorHarness>) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await waitForInitialProject(harness)
		const projectScope = harness.renderRuntime.readOne(harness.renderRuntime.getRootScope(), 'activeProject')
		if (projectScope) {
			return projectScope
		}
	}

	throw new Error('Timed out waiting for active project scope')
}

const waitForMockCall = async (mock: { mock: { calls: unknown[] } }) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (mock.mock.calls.length > 0) {
			return
		}
		await settleHarness()
	}
}

const waitForClipSourceId = async (harness: ReturnType<typeof createVideoEditorHarness>, clipScope: EditorScope, clipId: string) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const attrs = harness.renderRuntime.readAttrs(clipScope, ['sourceClipId'])
		if (attrs.sourceClipId === clipId) {
			return
		}
		await flushHarnessDkt(harness)
	}

	expect(harness.renderRuntime.readAttrs(clipScope, ['sourceClipId']).sourceClipId).toBe(clipId)
}

describe('createDktEditorRenderRuntime', () => {
	it('updates the render registry from explicit snapshot updates', () => {
		const store = createDktRegistryRenderStore()
		const remoteSnapshot = createEmptyRegistry()
		const listener = vi.fn()
		const unsubscribe = store.subscribe(listener)

		store.setSnapshot(remoteSnapshot)

		expect(store.getSnapshot()).toEqual(remoteSnapshot)
		expect(listener).toHaveBeenCalledTimes(1)
		unsubscribe()
	})

	it('reads session attrs and active project/timeline relations through scopes', async () => {
		const harness = createVideoEditorHarness(new MemoryWorkerAuthority())

		try {
			await waitForInitialProject(harness)
			const runtime = harness.renderRuntime
			const rootScope = runtime.getRootScope()
			const sessionScope = runtime.getSessionScope()
			const rootAttrs = runtime.readAttrs(rootScope, ['activeProjectId', 'projectCount'])

			expect(rootAttrs.projectCount).toBe(1)

			const projectScope = runtime.readOne(rootScope, 'activeProject')
			expect(projectScope?.type).toBe('project')

			const timelineScope = projectScope ? runtime.readOne(projectScope, 'activeTimeline') : null
			expect(timelineScope?.type).toBe('project')

			const trackScopes = timelineScope ? runtime.readMany(timelineScope, 'tracks') : []
			expect(trackScopes.map((scope) => scope.type)).toEqual(['track', 'track'])

			const sessionAttrs = runtime.readAttrs(sessionScope, ['cursor', 'timelineZoom'])
			expect(sessionAttrs).toMatchObject({
				cursor: harness.session$.cursor.get(),
				timelineZoom: harness.session$.timelineZoom.get(),
			})
		} finally {
			harness.destroy()
		}
	})

	it('notifies subscriptions when scoped attrs and rels change', async () => {
		const harness = createVideoEditorHarness(new MemoryWorkerAuthority())

		try {
			const projectScope = await waitForActiveProjectScope(harness)
			const runtime = harness.renderRuntime
			const sessionScope = runtime.getSessionScope()
			const timelineScope = projectScope ? runtime.readOne(projectScope, 'activeTimeline') : null

			expect(timelineScope).not.toBeNull()

			const attrListener = vi.fn()
			const relListener = vi.fn()
			const stopAttrs = runtime.subscribeAttrs(sessionScope, ['cursor'], attrListener)
			const stopRels = runtime.subscribeMany(timelineScope!, 'tracks', relListener)

			harness.actions.setCursor(1.25)
			harness.actions.addTrack('video')
			await flushHarnessDkt(harness)
			await waitForMockCall(attrListener)
			await waitForMockCall(relListener)

			expect(attrListener).toHaveBeenCalled()
			expect(relListener).toHaveBeenCalled()

			stopAttrs()
			stopRels()
		} finally {
			harness.destroy()
		}
	})

	it('maps clip-scoped dispatch to existing harness actions', async () => {
		const harness = createVideoEditorHarness(new MemoryWorkerAuthority())

		try {
			await waitForInitialProject(harness)
			harness.actions.importSampleResource()
			await flushHarnessDkt(harness)

			const registry = harness.projects$.get()
			const project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()

			const track = getTracks(registry, project!)[0]
			const clipId = getClipIdsForTrack(registry, track.id)[0]
			const clipScope = harness.renderRuntime.readMany(
				harness.renderRuntime.readOne(
					await waitForActiveProjectScope(harness),
					'activeTimeline',
				)!,
				'tracks',
			)[0]
			const firstClipScope = harness.renderRuntime.readMany(clipScope, 'clips')[0]

			await waitForClipSourceId(harness, firstClipScope, clipId)

			const dispatch = harness.renderRuntime.getDispatch(firstClipScope)
			dispatch('select')
			dispatch('moveBy', { delta: 0.5 })
			await flushHarnessDkt(harness)

			const movedAttrs = harness.projects$.get().entitiesById[clipId].attrs
			expect(harness.session$.selectedEntityId.get()).toBe(clipId)
			expect(movedAttrs.start).toBe(0.5)
		} finally {
			harness.destroy()
		}
	})
})
