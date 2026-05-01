import type { ClipAttrs, EntityId, ProjectRegistry } from '../domain/types'

export interface ClipInterval {
	id: EntityId
	start: number
	end: number
}

export interface WorkerDerivedIndexes {
	clipTrackById: Record<EntityId, EntityId>
	effectsByClipId: Record<EntityId, EntityId[]>
	clipIntervals: ClipInterval[]
}

export const buildWorkerDerivedIndexes = (registry: ProjectRegistry): WorkerDerivedIndexes => {
	const clipTrackById: Record<EntityId, EntityId> = {}
	const effectsByClipId: Record<EntityId, EntityId[]> = {}
	const clipIntervals: ClipInterval[] = []

	for (const entity of Object.values(registry.entitiesById)) {
		if (entity.type === 'track' && Array.isArray(entity.rels.clips)) {
			for (const clipId of entity.rels.clips) {
				clipTrackById[clipId] = entity.id
			}
		}

		if (entity.type === 'clip') {
			effectsByClipId[entity.id] = Array.isArray(entity.rels.effects) ? [...entity.rels.effects] : []
			const attrs = entity.attrs as unknown as ClipAttrs
			clipIntervals.push({
				id: entity.id,
				start: attrs.start,
				end: attrs.start + attrs.duration,
			})
		}
	}

	clipIntervals.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))

	return { clipTrackById, effectsByClipId, clipIntervals }
}
