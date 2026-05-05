import type { Observable } from '@legendapp/state'
import type {
	ClipAttrs,
	EditorSessionState,
	Entity,
	EntityId,
	EffectAttrs,
	ProjectAttrs,
	ProjectRegistry,
	RelValue,
	ResourceAttrs,
	TextAttrs,
	TimelineAttrs,
	TrackAttrs,
} from '../../domain/types'

export type ProjectsObservable = Observable<ProjectRegistry>

type EntityAttrsByType = {
	project: ProjectAttrs
	timeline: TimelineAttrs
	track: TrackAttrs
	resource: ResourceAttrs
	clip: ClipAttrs
	effect: EffectAttrs
	text: TextAttrs
	keyframe: { time: number; value: number; interpolation?: 'linear' | 'hold' }
}

type EntityRelsByType = {
	project: {
		resources: EntityId[]
		timelines: EntityId[]
		activeTimeline: EntityId
	}
	timeline: { tracks: EntityId[] }
	track: { clips: EntityId[] }
	resource: Record<string, RelValue>
	clip: {
		resource?: EntityId
		text?: EntityId
		effects: EntityId[]
		linkedAudioClip?: EntityId
		linkedVideoClip?: EntityId
	}
	effect: { clip: EntityId }
	text: Record<string, RelValue>
	keyframe: Record<string, RelValue>
}

export type EntityObservable = Observable<Entity>

export const entity$ = (
	projects$: ProjectsObservable,
	entityId: EntityId | null | undefined,
): EntityObservable | null =>
	entityId ? (projects$.entitiesById[entityId] as unknown as EntityObservable) : null

export const attrs$ = <Type extends keyof EntityAttrsByType>(
	projects$: ProjectsObservable,
	entityId: EntityId,
): Observable<EntityAttrsByType[Type]> =>
	projects$.entitiesById[entityId].attrs as unknown as Observable<EntityAttrsByType[Type]>

export const rels$ = <Type extends keyof EntityRelsByType>(
	projects$: ProjectsObservable,
	entityId: EntityId,
): Observable<EntityRelsByType[Type]> =>
	projects$.entitiesById[entityId].rels as unknown as Observable<EntityRelsByType[Type]>

export const clipAttrs$ = (
	projects$: ProjectsObservable,
	clipId: EntityId,
): Observable<ClipAttrs> => attrs$<'clip'>(projects$, clipId)

export const clipRels$ = (
	projects$: ProjectsObservable,
	clipId: EntityId,
): Observable<EntityRelsByType['clip']> => rels$<'clip'>(projects$, clipId)

export const resourceAttrs$ = (
	projects$: ProjectsObservable,
	resourceId: EntityId,
): Observable<ResourceAttrs> => attrs$<'resource'>(projects$, resourceId)

export const trackAttrs$ = (
	projects$: ProjectsObservable,
	trackId: EntityId,
): Observable<TrackAttrs> => attrs$<'track'>(projects$, trackId)

export const trackRels$ = (
	projects$: ProjectsObservable,
	trackId: EntityId,
): Observable<EntityRelsByType['track']> => rels$<'track'>(projects$, trackId)

export const effectAttrs$ = (
	projects$: ProjectsObservable,
	effectId: EntityId,
): Observable<EntityAttrsByType['effect']> => attrs$<'effect'>(projects$, effectId)

export const textAttrs$ = (
	projects$: ProjectsObservable,
	textId: EntityId,
): Observable<TextAttrs> => attrs$<'text'>(projects$, textId)

export const projectEntityAttrs$ = (
	projects$: ProjectsObservable,
	projectEntityId: EntityId,
): Observable<ProjectAttrs> => attrs$<'project'>(projects$, projectEntityId)

export const projectEntityRels$ = (
	projects$: ProjectsObservable,
	projectEntityId: EntityId,
): Observable<EntityRelsByType['project']> => rels$<'project'>(projects$, projectEntityId)

export const timelineRels$ = (
	projects$: ProjectsObservable,
	timelineId: EntityId,
): Observable<EntityRelsByType['timeline']> => rels$<'timeline'>(projects$, timelineId)

export const getActiveProjectId$ = (
	projects$: ProjectsObservable,
	session$: Observable<Pick<EditorSessionState, 'activeProjectId'>>,
): EntityId | null => session$.activeProjectId.get() ?? projects$.activeProjectId.get()

export const getProjectRootEntityId$ = (
	projects$: ProjectsObservable,
	projectId: EntityId | null | undefined,
): EntityId | null => projectId ? projects$.projects[projectId]?.rootEntityId.get() ?? null : null

export const getActiveProjectRootEntityId$ = (
	projects$: ProjectsObservable,
	session$: Observable<Pick<EditorSessionState, 'activeProjectId'>>,
): EntityId | null => getProjectRootEntityId$(projects$, getActiveProjectId$(projects$, session$))

export const getActiveTimelineId$ = (
	projects$: ProjectsObservable,
	projectId: EntityId | null | undefined,
): EntityId | null => {
	const rootEntityId = getProjectRootEntityId$(projects$, projectId)
	return rootEntityId ? projectEntityRels$(projects$, rootEntityId).activeTimeline.get() : null
}

export const getProjectResourceIds$ = (
	projects$: ProjectsObservable,
	projectId: EntityId | null | undefined,
): EntityId[] => {
	const rootEntityId = getProjectRootEntityId$(projects$, projectId)
	const resources = rootEntityId ? projectEntityRels$(projects$, rootEntityId).resources.get() : []
	return Array.isArray(resources) ? resources : []
}

export const getTimelineTrackIds$ = (
	projects$: ProjectsObservable,
	timelineId: EntityId | null | undefined,
): EntityId[] => {
	const tracks = timelineId ? timelineRels$(projects$, timelineId).tracks.get() : []
	return Array.isArray(tracks) ? tracks : []
}

export const getTimelineTrackIdsNode$ = (
	projects$: ProjectsObservable,
	timelineId: EntityId | null | undefined,
): Observable<EntityId[]> | null =>
	timelineId ? timelineRels$(projects$, timelineId).tracks as Observable<EntityId[]> : null

export const getTrackClipIds$ = (
	projects$: ProjectsObservable,
	trackId: EntityId,
): EntityId[] => {
	const clips = trackRels$(projects$, trackId).clips.get()
	return Array.isArray(clips) ? clips : []
}

export const getTrackClipIdsNode$ = (
	projects$: ProjectsObservable,
	trackId: EntityId,
): Observable<EntityId[]> => trackRels$(projects$, trackId).clips as Observable<EntityId[]>