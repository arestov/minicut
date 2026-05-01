import type {
	ClipAttrs,
	EditorSessionState,
	Entity,
	EntityId,
	PatchEnvelope,
	ProjectGraph,
	ProjectMeta,
	ProjectRegistry,
	ResourceAttrs,
} from './types'

const asArray = (value: Entity['rels'][string]): EntityId[] =>
	Array.isArray(value) ? value : []

const asEntityIds = (value: Entity['rels'][string]): EntityId[] => {
	if (Array.isArray(value)) {
		return value
	}

	return value ? [value] : []
}

export const getProjectEntity = (registry: ProjectRegistry, project: ProjectGraph): Entity =>
	registry.entitiesById[project.rootEntityId]

export const getActiveProjectId = (
	registry: ProjectRegistry,
	session?: Pick<EditorSessionState, 'activeProjectId'>,
): string | null => session?.activeProjectId ?? registry.activeProjectId

export const getActiveProject = (
	registry: ProjectRegistry,
	session?: Pick<EditorSessionState, 'activeProjectId'>,
): ProjectGraph | null => {
	const activeProjectId = getActiveProjectId(registry, session)
	if (!activeProjectId) {
		return null
	}

	return registry.projects[activeProjectId] ?? null
}

export const getProjectMetaList = (registry: ProjectRegistry): ProjectMeta[] =>
	Object.values(registry.projects).map((project) => {
		const projectEntity = getProjectEntity(registry, project)
		const resourceCount = asArray(projectEntity.rels.resources).length
		const clipCount = getTracks(registry, project).reduce(
			(count, track) => count + getClipIdsForTrack(registry, track.id).length,
			0,
		)

		return {
			id: project.id,
			title: String(projectEntity.attrs.title),
			version: project.version,
			resourceCount,
			clipCount,
		}
	})

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

export const getEntity = (registry: ProjectRegistry, entityId: EntityId | null): Entity | null =>
	entityId ? registry.entitiesById[entityId] ?? null : null

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

export const getResourceEntities = (registry: ProjectRegistry, project: ProjectGraph): Entity[] =>
	asArray(getProjectEntity(registry, project).rels.resources).map(
		(resourceId) => registry.entitiesById[resourceId],
	)

export const getClipIdsForTrack = (registry: ProjectRegistry, trackId: EntityId): EntityId[] =>
	asArray(registry.entitiesById[trackId]?.rels.clips)

export const getClipEntitiesForTrack = (registry: ProjectRegistry, trackId: EntityId): Entity[] =>
	getClipIdsForTrack(registry, trackId).map((clipId) => registry.entitiesById[clipId])

export const getSelectedClip = (
	registry: ProjectRegistry,
	session: Pick<EditorSessionState, 'activeProjectId' | 'selectedEntityId'>,
): Entity | null => {
	const project = getActiveProject(registry, session)
	if (!project || !session.selectedEntityId) {
		return null
	}

	const entity = getEntity(registry, session.selectedEntityId)
	return entity?.type === 'clip' ? entity : null
}

export const getClipLabel = (clip: Entity): string => {
	const attrs = clip.attrs as ClipAttrs
	return `${attrs.name} · ${attrs.start.toFixed(1)}s / ${attrs.duration.toFixed(1)}s`
}

export const getResourceLabel = (resource: Entity): string => {
	const attrs = resource.attrs as ResourceAttrs
	return `${attrs.name} · ${attrs.kind} · ${attrs.mime} · ${attrs.duration.toFixed(1)}s`
}

export const getTrackEnd = (registry: ProjectRegistry, trackId: EntityId): number =>
	getClipEntitiesForTrack(registry, trackId).reduce((max, clip) => {
		const attrs = clip.attrs as ClipAttrs
		return Math.max(max, attrs.start + attrs.duration)
	}, 0)

export const getActiveClipNamesAtCursor = (
	registry: ProjectRegistry,
	session: Pick<EditorSessionState, 'activeProjectId' | 'cursor'>,
): string[] => {
	const project = getActiveProject(registry, session)
	if (!project) {
		return []
	}

	return getTracks(registry, project)
		.flatMap((track) => getClipEntitiesForTrack(registry, track.id))
		.filter((clip) => {
			const attrs = clip.attrs as ClipAttrs
			return session.cursor >= attrs.start && session.cursor < attrs.start + attrs.duration
		})
		.map((clip) => String((clip.attrs as ClipAttrs).name))
}

export const withEnvelopeVersion = (
	project: ProjectGraph,
	envelope: PatchEnvelope,
): ProjectGraph => ({
	...project,
	version: envelope.version,
})
