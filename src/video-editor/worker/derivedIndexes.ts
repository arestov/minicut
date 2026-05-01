import type { EntityId, ProjectRegistry } from '../domain/types'

export interface WorkerDerivedIndexes {
	clipTrackById: Record<EntityId, EntityId>
	effectsByClipId: Record<EntityId, EntityId[]>
}

export const buildWorkerDerivedIndexes = (registry: ProjectRegistry): WorkerDerivedIndexes => {
	const clipTrackById: Record<EntityId, EntityId> = {}
	const effectsByClipId: Record<EntityId, EntityId[]> = {}

	for (const entity of Object.values(registry.entitiesById)) {
		if (entity.type === 'track' && Array.isArray(entity.rels.clips)) {
			for (const clipId of entity.rels.clips) {
				clipTrackById[clipId] = entity.id
			}
		}

		if (entity.type === 'clip') {
			effectsByClipId[entity.id] = Array.isArray(entity.rels.effects) ? [...entity.rels.effects] : []
		}
	}

	return { clipTrackById, effectsByClipId }
}
