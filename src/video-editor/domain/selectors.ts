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

export const getProjectEntity = (project: ProjectGraph): Entity =>
	project.entities[project.rootEntityId]

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
		const projectEntity = getProjectEntity(project)
		const resourceCount = asArray(projectEntity.rels.resources).length
		const clipCount = Object.values(project.entities).filter(
			(entity) => entity.type === 'clip',
		).length

		return {
			id: project.id,
			title: String(projectEntity.attrs.title),
			version: project.version,
			resourceCount,
			clipCount,
		}
	})

export const getActiveTimelineId = (project: ProjectGraph): EntityId =>
	String(getProjectEntity(project).rels.activeTimeline)

export const getActiveTimeline = (project: ProjectGraph): Entity =>
	project.entities[getActiveTimelineId(project)]

export const getTrackIds = (project: ProjectGraph): EntityId[] =>
	asArray(getActiveTimeline(project).rels.tracks)

export const getTracks = (project: ProjectGraph): Entity[] =>
	getTrackIds(project).map((trackId) => project.entities[trackId])

export const getVideoTrack = (project: ProjectGraph): Entity | null =>
	getTracks(project).find((entity) => entity.attrs.kind === 'video') ?? null

export const getEntity = (project: ProjectGraph, entityId: EntityId | null): Entity | null =>
	entityId ? project.entities[entityId] ?? null : null

export const getResourceEntities = (project: ProjectGraph): Entity[] =>
	asArray(getProjectEntity(project).rels.resources).map(
		(resourceId) => project.entities[resourceId],
	)

export const getClipIdsForTrack = (project: ProjectGraph, trackId: EntityId): EntityId[] =>
	asArray(project.entities[trackId]?.rels.clips)

export const getClipEntitiesForTrack = (project: ProjectGraph, trackId: EntityId): Entity[] =>
	getClipIdsForTrack(project, trackId).map((clipId) => project.entities[clipId])

export const getSelectedClip = (
	registry: ProjectRegistry,
	session: Pick<EditorSessionState, 'activeProjectId' | 'selectedEntityId'>,
): Entity | null => {
	const project = getActiveProject(registry, session)
	if (!project || !session.selectedEntityId) {
		return null
	}

	const entity = getEntity(project, session.selectedEntityId)
	return entity?.type === 'clip' ? entity : null
}

export const getClipLabel = (clip: Entity): string => {
	const attrs = clip.attrs as ClipAttrs
	return `${attrs.name} · ${attrs.start.toFixed(1)}s / ${attrs.duration.toFixed(1)}s`
}

export const getResourceLabel = (resource: Entity): string => {
	const attrs = resource.attrs as ResourceAttrs
	return `${attrs.name} · ${attrs.kind} · ${attrs.duration.toFixed(1)}s`
}

export const getTrackEnd = (project: ProjectGraph, trackId: EntityId): number =>
	getClipEntitiesForTrack(project, trackId).reduce((max, clip) => {
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

	return getTracks(project)
		.flatMap((track) => getClipEntitiesForTrack(project, track.id))
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
