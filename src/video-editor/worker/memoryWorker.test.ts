import { getActiveProject, getClipIdsForTrack, getProjectEntity, getVideoTrack } from '../domain/selectors'
import { CMD, type Entity } from '../domain/types'
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
})
