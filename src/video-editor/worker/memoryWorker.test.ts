// @ts-nocheck
// TODO(Phase 5): rewrite this suite for hard DKT runtime (no registry fallback).
import { getActiveProject, getClipIdsForTrack, getProjectEntity, getResourceEntities, getVideoTrack } from '../domain/selectors'
import { defineShape } from '../../dkt-react-sync/shape/defineShape'
import { createMiniCutPageSyncRuntime } from '../dkt/runtime/createMiniCutPageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import { CMD, PATCH, type Entity } from '../domain/types'
import { MemoryWorkerAuthority } from './memoryWorker'

const createClipWithEffect = () => {
	const worker = new MemoryWorkerAuthority()
	const projectResult = worker.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'Worker test' } })
	const projectId = String(projectResult.createdIds?.projectId)
	const resourceResult = worker.dispatch({
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'Source', kind: 'video', duration: 6 },
	})
	const clipResult = worker.dispatch({
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId: String(resourceResult.createdIds?.resourceId) },
	})
	const clipId = String(clipResult.createdIds?.clipId)
	const effectResult = worker.dispatch({
		c: CMD.EFFECT_ADD,
		p: { id: clipId, name: 'Blur', kind: 'blur', amount: 0.25 },
	})

	return { worker, projectId, clipId, effectId: String(effectResult.createdIds?.effectId) }
}

const flushMicrotasks = async () => {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve()
	}
}

const waitForRootScope = (pageRuntime: ReturnType<typeof createMiniCutPageSyncRuntime>): Promise<ReactSyncScopeHandle> => {
	const current = pageRuntime.getRootScope()
	if (current) {
		return Promise.resolve(current)
	}

	return new Promise((resolve) => {
		const stop = pageRuntime.subscribeRootScope(() => {
			const rootScope = pageRuntime.getRootScope()
			if (!rootScope) {
				return
			}

			stop()
			resolve(rootScope)
		})
	})
}

const waitForOneRel = (
	pageRuntime: ReturnType<typeof createMiniCutPageSyncRuntime>,
	scope: ReactSyncScopeHandle,
	relName: string,
): Promise<ReactSyncScopeHandle> => {
	const current = pageRuntime.readOne(scope, relName)
	if (current) {
		return Promise.resolve(current)
	}

	return new Promise((resolve) => {
		const stop = pageRuntime.subscribeOne(scope, relName, () => {
			const next = pageRuntime.readOne(scope, relName)
			if (!next) {
				return
			}

			stop()
			resolve(next)
		})
	})
}

const waitForManyRel = (
	pageRuntime: ReturnType<typeof createMiniCutPageSyncRuntime>,
	scope: ReactSyncScopeHandle,
	relName: string,
): Promise<readonly ReactSyncScopeHandle[]> => {
	const current = pageRuntime.readMany(scope, relName)
	if (current.length > 0) {
		return Promise.resolve(current)
	}

	return new Promise((resolve) => {
		const stop = pageRuntime.subscribeMany(scope, relName, () => {
			const next = pageRuntime.readMany(scope, relName)
			if (next.length === 0) {
				return
			}

			stop()
			resolve(next)
		})
	})
}

const waitForStringAttr = (
	pageRuntime: ReturnType<typeof createMiniCutPageSyncRuntime>,
	scope: ReactSyncScopeHandle,
	attrName: string,
): Promise<string> => {
	const current = pageRuntime.readAttrs(scope, [attrName])[attrName]
	if (typeof current === 'string') {
		return Promise.resolve(current)
	}

	return new Promise((resolve) => {
		const stop = pageRuntime.subscribeAttrs(scope, [attrName], () => {
			const next = pageRuntime.readAttrs(scope, [attrName])[attrName]
			if (typeof next !== 'string') {
				return
			}

			stop()
			resolve(next)
		})
	})
}

// Behavior contract: editor boot and timeline mutations should be validated through DKT attrs/rels and scoped actions.
// Skipped: registry API removed in phase 1. Rebuild through DKT model contracts in phase 5.
describe.skip('MemoryWorkerAuthority', () => {
	it('applies patch envelopes in place while keeping graph indexes consistent', () => {
		const { worker, projectId, clipId, effectId } = createClipWithEffect()
		const before = worker.getSnapshot()
		const project = getActiveProject(before, { activeProjectId: projectId })
		expect(project).not.toBeNull()
		const track = getVideoTrack(before, project!)
		expect(track).not.toBeNull()
		expect(getClipIdsForTrack(before, track!.id)).toContain(clipId)
		expect(before.entitiesById[effectId]?.type).toBe('effect')
		expect(worker.getDerivedIndexes().clipTrackById[clipId]).toBe(track!.id)

		const deleteResult = worker.dispatch({
			c: CMD.TIMELINE_DELETE_CLIP,
			p: { id: clipId },
		})

		expect(deleteResult.deletedIds).toEqual([clipId, effectId])
		const after = worker.getSnapshot()
		expect(after.entitiesById[clipId]).toBeUndefined()
		expect(after.entitiesById[effectId]).toBeUndefined()
		expect(getClipIdsForTrack(after, track!.id)).not.toContain(clipId)
		expect(worker.getDerivedIndexes().clipTrackById[clipId]).toBeUndefined()
	})

	it('keeps project roots intact after deleting a clip node', () => {
		const { worker, projectId, clipId } = createClipWithEffect()
		worker.dispatch({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: clipId } })

		const snapshot = worker.getSnapshot()
		const project = snapshot.projects[projectId]
		const projectEntity = getProjectEntity(snapshot, project) as Entity
		expect(projectEntity.type).toBe('project')
		expect(Array.isArray(projectEntity.rels.resources)).toBe(true)
		expect(snapshot.projects[projectId].version).toBe(5)
	})

	it('does not increment project version when invalid commands throw', () => {
		const { worker, projectId, clipId } = createClipWithEffect()
		const versionBefore = worker.getSnapshot().projects[projectId].version

		expect(() =>
			worker.dispatch({
				c: CMD.TIMELINE_SPLIT_CLIP,
				p: { id: clipId, time: 0 },
			}),
		).toThrow('Split time must be inside clip bounds')

		const versionAfter = worker.getSnapshot().projects[projectId].version
		expect(versionAfter).toBe(versionBefore)
	})

	it('applies sequential versions when dispatch calls happen in quick succession', async () => {
		const worker = new MemoryWorkerAuthority()
		const projectResult = worker.dispatch({ c: CMD.PROJECT_CREATE, p: {} })
		const projectId = String(projectResult.createdIds?.projectId)

		const [first, second] = await Promise.all([
			Promise.resolve().then(() =>
				worker.dispatch({
					c: CMD.RESOURCE_IMPORT,
					p: { projectId, name: 'A', kind: 'video', duration: 1 },
				}),
			),
			Promise.resolve().then(() =>
				worker.dispatch({
					c: CMD.RESOURCE_IMPORT,
					p: { projectId, name: 'B', kind: 'video', duration: 1 },
				}),
			),
		])

		expect([first.envelope.version, second.envelope.version].sort((a, b) => a - b)).toEqual([2, 3])
		expect(worker.getSnapshot().projects[projectId].version).toBe(3)
	})

	it('keeps clip-track indexes empty for newly created tracks without clips', () => {
		const worker = new MemoryWorkerAuthority()
		const projectResult = worker.dispatch({ c: CMD.PROJECT_CREATE, p: {} })
		const projectId = String(projectResult.createdIds?.projectId)

		worker.dispatch({
			c: CMD.TRACK_CREATE,
			p: { projectId, kind: 'audio', name: 'A2' },
		})

		const indexes = worker.getDerivedIndexes()
		expect(indexes.clipTrackById).toEqual({})
	})

	it('removes patch listeners after destroy', () => {
		const worker = new MemoryWorkerAuthority()
		const listener = vi.fn()
		worker.subscribe(listener)
		worker.destroy()

		worker.dispatch({ c: CMD.PROJECT_CREATE, p: {} })
		expect(listener).not.toHaveBeenCalled()
	})

	it('applies a mixed command sequence deterministically', () => {
		const worker = new MemoryWorkerAuthority()
		const projectResult = worker.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'Command combo' } })
		const projectId = String(projectResult.createdIds?.projectId)

		const videoImport = worker.dispatch({ c: CMD.RESOURCE_IMPORT, p: { projectId, name: 'Video', kind: 'video', duration: 6 } })
		const audioImport = worker.dispatch({ c: CMD.RESOURCE_IMPORT, p: { projectId, name: 'Audio', kind: 'audio', duration: 3 } })
		const videoClip = worker.dispatch({ c: CMD.TIMELINE_ADD_CLIP, p: { projectId, resourceId: String(videoImport.createdIds?.resourceId) } })
		const audioClip = worker.dispatch({ c: CMD.TIMELINE_ADD_CLIP, p: { projectId, resourceId: String(audioImport.createdIds?.resourceId) } })
		const videoClipId = String(videoClip.createdIds?.clipId)
		const audioClipId = String(audioClip.createdIds?.clipId)
		worker.dispatch({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: videoClipId, delta: 1.5 } })
		worker.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: videoClipId, attrs: { name: 'Renamed', fadeIn: 0.5, fadeOut: 0.5 } } })
		const effect = worker.dispatch({ c: CMD.EFFECT_ADD, p: { id: videoClipId, name: 'Tint', kind: 'tint', amount: 0.35 } })
		worker.dispatch({ c: CMD.EFFECT_REMOVE, p: { id: videoClipId, effectId: String(effect.createdIds?.effectId) } })
		worker.dispatch({ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: videoClipId, time: 3 } })
		worker.dispatch({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: audioClipId } })

		const snapshot = worker.getSnapshot()
		expect(snapshot.projects[projectId]).toBeDefined()
		expect(snapshot.entitiesById[audioClipId]).toBeUndefined()
		expect(Object.values(snapshot.entitiesById).some((entity) => entity.type === 'effect')).toBe(false)
	})

	it('streams project hierarchy to a page DKT replica over openDktTransport', async () => {
		const worker = new MemoryWorkerAuthority()
		const pageRuntime = createMiniCutPageSyncRuntime({ transport: worker.openDktTransport() })
		const shape = defineShape({
			one: {
				pioneer: defineShape({
					many: {
						project: defineShape({
							attrs: ['sourceProjectId'],
						}),
					},
				}),
			},
		})

		try {
			pageRuntime.bootstrap({ sessionKey: 'session:test' })
			const rootScope = await waitForRootScope(pageRuntime)
			pageRuntime.mountShape(rootScope, shape)
			const appScope = await waitForOneRel(pageRuntime, rootScope, 'pioneer')
			worker.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'Replica project' } })
			await flushMicrotasks()
			const projectScopes = await waitForManyRel(pageRuntime, appScope, 'project')
			const sourceProjectId = await waitForStringAttr(pageRuntime, projectScopes[0], 'sourceProjectId')

			expect(sourceProjectId).toBeTypeOf('string')
		} finally {
			pageRuntime.destroy()
			worker.destroy()
		}
	})
})
