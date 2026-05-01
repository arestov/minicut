import { getActiveProject, getClipIdsForTrack, getProjectEntity, getResourceEntities, getVideoTrack } from '../domain/selectors'
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

describe('MemoryWorkerAuthority', () => {
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

	it('undoes and redoes commands through registry replacement envelopes', () => {
		const worker = new MemoryWorkerAuthority()
		const listener = vi.fn()
		worker.subscribe(listener)
		const projectResult = worker.dispatch({ c: CMD.PROJECT_CREATE, p: {} })
		const projectId = String(projectResult.createdIds?.projectId)
		const afterProject = worker.getSnapshot()

		worker.dispatch({ c: CMD.RESOURCE_IMPORT, p: { projectId, name: 'Undo source', kind: 'video', duration: 2 } })
		expect(getResourceEntities(worker.getSnapshot(), worker.getSnapshot().projects[projectId])).toHaveLength(1)
		expect(worker.getHistoryState()).toEqual({ canUndo: true, canRedo: false })

		const undoEnvelope = worker.undo()
		expect(undoEnvelope?.patches[0]).toMatchObject({ c: PATCH.REGISTRY_SET })
		expect(worker.getSnapshot()).toEqual(afterProject)
		expect(worker.getHistoryState()).toEqual({ canUndo: true, canRedo: true })

		worker.redo()
		expect(getResourceEntities(worker.getSnapshot(), worker.getSnapshot().projects[projectId])).toHaveLength(1)
		expect(worker.getHistoryState()).toEqual({ canUndo: true, canRedo: false })
		expect(listener).toHaveBeenCalledWith(expect.objectContaining({ patches: [expect.objectContaining({ c: PATCH.REGISTRY_SET })] }))
	})

	it('round-trips a mixed command sequence through undo and redo', () => {
		const worker = new MemoryWorkerAuthority()
		const snapshots = [worker.getSnapshot()]
		const projectResult = worker.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'History combo' } })
		const projectId = String(projectResult.createdIds?.projectId)
		snapshots.push(worker.getSnapshot())

		const videoImport = worker.dispatch({ c: CMD.RESOURCE_IMPORT, p: { projectId, name: 'Video', kind: 'video', duration: 6 } })
		snapshots.push(worker.getSnapshot())
		const audioImport = worker.dispatch({ c: CMD.RESOURCE_IMPORT, p: { projectId, name: 'Audio', kind: 'audio', duration: 3 } })
		snapshots.push(worker.getSnapshot())
		const videoClip = worker.dispatch({ c: CMD.TIMELINE_ADD_CLIP, p: { projectId, resourceId: String(videoImport.createdIds?.resourceId) } })
		snapshots.push(worker.getSnapshot())
		const audioClip = worker.dispatch({ c: CMD.TIMELINE_ADD_CLIP, p: { projectId, resourceId: String(audioImport.createdIds?.resourceId) } })
		snapshots.push(worker.getSnapshot())
		const videoClipId = String(videoClip.createdIds?.clipId)
		const audioClipId = String(audioClip.createdIds?.clipId)
		worker.dispatch({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: videoClipId, delta: 1.5 } })
		snapshots.push(worker.getSnapshot())
		worker.dispatch({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: videoClipId, attrs: { name: 'Renamed', fadeIn: 0.5, fadeOut: 0.5 } } })
		snapshots.push(worker.getSnapshot())
		const effect = worker.dispatch({ c: CMD.EFFECT_ADD, p: { id: videoClipId, name: 'Tint', kind: 'tint', amount: 0.35 } })
		snapshots.push(worker.getSnapshot())
		worker.dispatch({ c: CMD.EFFECT_REMOVE, p: { id: videoClipId, effectId: String(effect.createdIds?.effectId) } })
		snapshots.push(worker.getSnapshot())
		worker.dispatch({ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: videoClipId, time: 3 } })
		snapshots.push(worker.getSnapshot())
		worker.dispatch({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: audioClipId } })
		snapshots.push(worker.getSnapshot())

		for (let index = snapshots.length - 2; index >= 0; index -= 1) {
			worker.undo()
			expect(worker.getSnapshot()).toEqual(snapshots[index])
		}
		expect(worker.getHistoryState()).toEqual({ canUndo: false, canRedo: true })

		for (let index = 1; index < snapshots.length; index += 1) {
			worker.redo()
			expect(worker.getSnapshot()).toEqual(snapshots[index])
		}
		expect(worker.getHistoryState()).toEqual({ canUndo: true, canRedo: false })
	})
})
