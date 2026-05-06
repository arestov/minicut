/**
 * Selector functions for the render pipeline's registry-shaped data.
 * These are isolated from domain/selectors.ts which is being removed.
 */

import type { ClipAttrs, Entity, EntityId, ProjectGraph, ProjectRegistry, RelValue, ResourceAttrs } from './registryTypes'

const asArray = (value: RelValue): EntityId[] =>
	Array.isArray(value) ? value : []

const asEntityIds = (value: RelValue): EntityId[] => {
	if (Array.isArray(value)) {
		return value
	}
	return value ? [value] : []
}

export const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs
export const asResourceAttrs = (attrs: Record<string, unknown>): ResourceAttrs => attrs as unknown as ResourceAttrs

export const getProjectEntity = (registry: ProjectRegistry, project: ProjectGraph): Entity =>
	registry.entitiesById[project.rootEntityId]

export const getActiveTimelineId = (registry: ProjectRegistry, project: ProjectGraph): EntityId =>
	String(getProjectEntity(registry, project).rels.activeTimeline)

export const getActiveTimeline = (registry: ProjectRegistry, project: ProjectGraph): Entity =>
	registry.entitiesById[getActiveTimelineId(registry, project)]

export const getTrackIds = (registry: ProjectRegistry, project: ProjectGraph): EntityId[] =>
	asArray(getActiveTimeline(registry, project).rels.tracks)

export const getTracks = (registry: ProjectRegistry, project: ProjectGraph): Entity[] =>
	getTrackIds(registry, project).map((trackId) => registry.entitiesById[trackId])

export const getVideoTrack = (registry: ProjectRegistry, project: ProjectGraph): Entity | null =>
	getTracks(registry, project).find((entity) => entity.attrs.kind === 'video') ?? null

export const getAudioTrack = (registry: ProjectRegistry, project: ProjectGraph): Entity | null =>
	getTracks(registry, project).find((entity) => entity.attrs.kind === 'audio') ?? null

export const getEntity = (registry: ProjectRegistry, entityId: EntityId | null): Entity | null =>
	entityId ? registry.entitiesById[entityId] ?? null : null

export const getResourceEntities = (registry: ProjectRegistry, project: ProjectGraph): Entity[] =>
	asArray(getProjectEntity(registry, project).rels.resources).map(
		(resourceId) => registry.entitiesById[resourceId],
	)

export const getClipIdsForTrack = (registry: ProjectRegistry, trackId: EntityId): EntityId[] =>
	asArray(registry.entitiesById[trackId]?.rels.clips)

export const getClipEntitiesForTrack = (registry: ProjectRegistry, trackId: EntityId): Entity[] =>
	getClipIdsForTrack(registry, trackId).map((clipId) => registry.entitiesById[clipId])

export const getTrackForClip = (registry: ProjectRegistry, clipId: EntityId): Entity | null =>
	Object.values(registry.entitiesById).find((entity) =>
		entity?.type === 'track' && getClipEntitiesForTrack(registry, entity.id).some((c) => c?.id === clipId),
	) ?? null

export const getTrackEnd = (registry: ProjectRegistry, trackId: EntityId): number =>
	getClipEntitiesForTrack(registry, trackId).reduce((max, clip) => {
		if (!clip) return max
		const attrs = asClipAttrs(clip.attrs)
		return Math.max(max, attrs.start + attrs.duration)
	}, 0)

const isEntityReachableFromProject = (
	registry: ProjectRegistry,
	project: ProjectGraph,
	entityId: EntityId,
): boolean => {
	const visited = new Set<EntityId>()
	const queue: EntityId[] = [project.rootEntityId]

	while (queue.length > 0) {
		const currentId = queue.pop() as EntityId
		if (currentId === entityId) {
			return true
		}
		if (visited.has(currentId)) {
			continue
		}

		visited.add(currentId)
		const entity = registry.entitiesById[currentId]
		if (!entity) {
			continue
		}

		for (const relValue of Object.values(entity.rels)) {
			for (const relId of asEntityIds(relValue)) {
				if (!visited.has(relId)) {
					queue.push(relId)
				}
			}
		}
	}

	return false
}

export const getProjectForEntity = (
	registry: ProjectRegistry,
	entityId: EntityId,
): ProjectGraph | null =>
	Object.values(registry.projects).find((project) =>
		isEntityReachableFromProject(registry, project, entityId),
	) ?? null
