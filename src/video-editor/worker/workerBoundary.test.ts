import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { getClipIdsForTrack, getResourceEntities, getVideoTrack } from '../domain/selectors'
import { CMD, PATCH, type ClipAttrs } from '../domain/types'
import { MemoryWorkerAuthority } from './memoryWorker'

const createAuthorityWithClip = () => {
	const authority = new MemoryWorkerAuthority()
	const projectResult = authority.dispatch({ c: CMD.PROJECT_CREATE, p: {} })
	const projectId = String(projectResult.createdIds?.projectId)
	const importResult = authority.dispatch({
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'Boundary source', kind: 'video', duration: 5 },
	})
	const clipResult = authority.dispatch({
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
	})

	return { authority, projectId, clipId: String(clipResult.createdIds?.clipId) }
}

describe('worker boundary and multi-client edges', () => {
	it('returns snapshots that are safe to structuredClone', () => {
		const { authority } = createAuthorityWithClip()
		const snapshot = authority.getSnapshot()

		expect(() => structuredClone(snapshot)).not.toThrow()
		expect(structuredClone(snapshot)).toEqual(snapshot)
	})

	it('handles concurrent updates deterministically with last write winning', () => {
		const { authority, clipId } = createAuthorityWithClip()

		authority.dispatch({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: clipId, delta: 10 } })
		authority.dispatch({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: clipId, delta: 10 } })

		const attrs = authority.getSnapshot().entitiesById[clipId].attrs as unknown as ClipAttrs
		expect(attrs.start).toBe(20)
	})

	it('rejects update after delete without corrupting worker state', () => {
		const { authority, projectId, clipId } = createAuthorityWithClip()
		authority.dispatch({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: clipId } })

		expect(() => authority.dispatch({
			c: CMD.CLIP_UPDATE_ATTRS,
			p: { id: clipId, attrs: { name: 'Deleted update' } },
		})).toThrow('Unknown entity')

		const snapshot = authority.getSnapshot()
		const project = snapshot.projects[projectId]
		const track = getVideoTrack(snapshot, project)
		expect(track).not.toBeNull()
		expect(getClipIdsForTrack(snapshot, String(track?.id))).toEqual([])
	})

	it('late join receives a full consistent snapshot after prior operations', () => {
		const { authority, projectId, clipId } = createAuthorityWithClip()
		authority.dispatch({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: clipId, delta: 2 } })
		authority.dispatch({ c: CMD.EFFECT_ADD, p: { id: clipId, name: 'Tint', kind: 'tint', amount: 0.35 } })

		const lateSnapshot = authority.getSnapshot()
		const project = lateSnapshot.projects[projectId]
		expect(getResourceEntities(lateSnapshot, project)).toHaveLength(1)
		expect((lateSnapshot.entitiesById[clipId].attrs as unknown as ClipAttrs).start).toBe(2)
		expect(lateSnapshot.entitiesById[clipId].rels.effects).toHaveLength(1)
	})

	it('reapplying idempotent attrs patch keeps state stable', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const envelope = {
			projectId,
			version: registry.projects[projectId].version + 1,
			patches: [
				{
					c: PATCH.ATTRS_MERGE,
					p: { id: registry.projects[projectId].rootEntityId, attrs: { title: 'Stable title' } },
				},
			],
		}

		const once = applyPatchEnvelopeToRegistry(registry, envelope)
		const twice = applyPatchEnvelopeToRegistry(once, envelope)
		expect(twice).toEqual(once)
	})
})
