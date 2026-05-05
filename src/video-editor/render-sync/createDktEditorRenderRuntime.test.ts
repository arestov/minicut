import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { createVideoEditorHarness } from '../app/createVideoEditorHarness'
import { createEmptyRegistry } from '../domain/createProject'
import { getActiveProject, getClipIdsForTrack, getTracks } from '../domain/selectors'
import { DKT_MSG } from '../dkt/shared/messageTypes'
import { MemoryWorkerAuthority } from '../worker/memoryWorker'
import { createDktRegistryRenderStore } from './DktRegistryRenderStore'

const flushMicrotasks = async () => {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve()
	}
}

const settleHarness = async () => {
	await flushMicrotasks()
	await flushMicrotasks()
}

describe('createDktEditorRenderRuntime', () => {
	it('updates the render registry from DKT sync root attrs', () => {
		const store = createDktRegistryRenderStore()
		const remoteSnapshot = createEmptyRegistry()
		const listener = vi.fn()
		const unsubscribe = store.subscribe(listener)

		store.handleDktSyncMessage({ type: DKT_MSG.SYNC_HANDLE, syncType: SYNCR_TYPES.SET_DICT, payload: ['registrySnapshot'] })
		store.handleDktSyncMessage({ type: DKT_MSG.SYNC_HANDLE, syncType: SYNCR_TYPES.TREE_ROOT, payload: { node_id: 'root' } })
		store.handleDktSyncMessage({
			type: DKT_MSG.SYNC_HANDLE,
			syncType: SYNCR_TYPES.UPDATE,
			payload: [4, 'root', [0, remoteSnapshot]],
		})

		expect(store.getSnapshot()).toEqual(remoteSnapshot)
		expect(listener).toHaveBeenCalledTimes(1)
		unsubscribe()
	})

	it('reads session attrs and active project/timeline relations through scopes', async () => {
		const harness = createVideoEditorHarness(new MemoryWorkerAuthority())

		try {
			await settleHarness()
			const runtime = harness.renderRuntime
			const rootScope = runtime.getRootScope()
			const sessionScope = runtime.getSessionScope()
			const rootAttrs = runtime.readAttrs(rootScope, ['activeProjectId', 'projectCount'])

			expect(rootAttrs.projectCount).toBe(1)
			expect(rootAttrs.activeProjectId).toBe(harness.session$.activeProjectId.get())

			const projectScope = runtime.readOne(rootScope, 'activeProject')
			expect(projectScope?.type).toBe('project')

			const timelineScope = projectScope ? runtime.readOne(projectScope, 'activeTimeline') : null
			expect(timelineScope?.type).toBe('timeline')

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
			await settleHarness()
			const runtime = harness.renderRuntime
			const sessionScope = runtime.getSessionScope()
			const projectScope = runtime.readOne(runtime.getRootScope(), 'activeProject')
			const timelineScope = projectScope ? runtime.readOne(projectScope, 'activeTimeline') : null

			expect(timelineScope).not.toBeNull()

			const attrListener = vi.fn()
			const relListener = vi.fn()
			const stopAttrs = runtime.subscribeAttrs(sessionScope, ['cursor'], attrListener)
			const stopRels = runtime.subscribeMany(timelineScope!, 'tracks', relListener)

			harness.actions.setCursor(1.25)
			harness.actions.addTrack('video')
			await settleHarness()

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
			await settleHarness()
			harness.actions.importSampleResource()
			await settleHarness()

			const registry = harness.projects$.get()
			const project = getActiveProject(registry, harness.session$.get())
			expect(project).not.toBeNull()

			const track = getTracks(registry, project!)[0]
			const clipId = getClipIdsForTrack(registry, track.id)[0]
			const clipScope = harness.renderRuntime.readMany(
				harness.renderRuntime.readOne(
					harness.renderRuntime.readOne(harness.renderRuntime.getRootScope(), 'activeProject')!,
					'activeTimeline',
				)!,
				'tracks',
			)[0]
			const firstClipScope = harness.renderRuntime.readMany(clipScope, 'clips')[0]

			expect(firstClipScope.nodeId).toBe(clipId)

			const dispatch = harness.renderRuntime.getDispatch(firstClipScope)
			dispatch('select')
			dispatch('moveBy', { delta: 0.5 })
			await settleHarness()

			const movedAttrs = harness.projects$.get().entitiesById[clipId].attrs
			expect(harness.session$.selectedEntityId.get()).toBe(clipId)
			expect(movedAttrs.start).toBe(0.5)
		} finally {
			harness.destroy()
		}
	})
})
