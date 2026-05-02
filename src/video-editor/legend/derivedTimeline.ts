import { computed, type Observable } from '@legendapp/state'
import type {
	AnimatedScalar,
	EditorSessionState,
	EntityId,
	KeyframeAttrs,
	ProjectRegistry,
	ResourceAttrs,
} from '../domain/types'
import type { ScalarKeyframe } from '../render/timing'
import { evaluateFadeOpacity, evaluateKeyframedScalar } from '../render/timing'
import {
	attrs$,
	clipAttrs$,
	clipRels$,
	effectAttrs$,
	getActiveProjectId$,
	getActiveTimelineId$,
	getProjectRootEntityId$,
	getTimelineTrackIds$,
	getTrackClipIds$,
	projectEntityAttrs$,
	projectEntityRels$,
	resourceAttrs$,
	trackAttrs$,
} from './observableSelectors'

const fallbackPlaybackDuration = 20

export interface TimelineClipInterval {
	id: EntityId
	trackId: EntityId
	trackKind: ResourceAttrs['kind']
	trackMuted: boolean
	start: number
	end: number
}

export interface RenderedClip {
	id: string
	name: string
	color: string
	resourceName: string
	resourceKind: ResourceAttrs['kind']
	resourceUrl: string
	mime: string
	inPoint: number
	start: number
	opacity: number
	transform: { x: number; y: number; scale: number; rotation: number }
	audio: { gain: number; pan: number }
	filters: string[]
}

export interface ResolvedAnimatedScalar {
	value: number
	keyframes?: ScalarKeyframe[]
}

export interface PreviewClipSource {
	id: string
	name: string
	color: string
	resourceName: string
	resourceKind: ResourceAttrs['kind']
	resourceUrl: string
	mime: string
	inPoint: number
	start: number
	duration: number
	fadeIn: number
	fadeOut: number
	opacity: ResolvedAnimatedScalar
	transform: {
		x: ResolvedAnimatedScalar
		y: ResolvedAnimatedScalar
		scale: ResolvedAnimatedScalar
		rotation: ResolvedAnimatedScalar
	}
	audio: { gain: number; pan: number }
	filters: string[]
}

export interface PreviewStructure {
	clipSources: PreviewClipSource[]
}

export interface PreviewScene {
	cursor: number
	isPlaying: boolean
	renderedClips: RenderedClip[]
	visualRenderedClips: RenderedClip[]
	audioRenderedClips: RenderedClip[]
	activeClipNames: string[]
	canvasClips: Array<{
		name: string
		color: string
		kind: ResourceAttrs['kind']
		opacity: number
	}>
}

export interface PreviewFrame {
	cursor: number
	renderedClips: RenderedClip[]
	visualRenderedClips: RenderedClip[]
	audioRenderedClips: RenderedClip[]
	activeClipNames: string[]
}

export interface SelectedClipTrackPosition {
	trackId: EntityId
	trackName: string
	ordinal: number
}

export const getTimelineClipIntervals$ = (
	projects$: Observable<ProjectRegistry>,
	projectId: EntityId | null | undefined,
): TimelineClipInterval[] => {
	const timelineId = getActiveTimelineId$(projects$, projectId)
	const trackIds = getTimelineTrackIds$(projects$, timelineId)
	const intervals: TimelineClipInterval[] = []

	for (const trackId of trackIds) {
		const track$ = trackAttrs$(projects$, trackId)
		const trackKind = String(track$.kind.get()) as ResourceAttrs['kind']
		const trackMuted = track$.muted.get() === true
		const clipIds = getTrackClipIds$(projects$, trackId)

		for (const clipId of clipIds) {
			const clip$ = clipAttrs$(projects$, clipId)
			const start = Number(clip$.start.get())
			const duration = Number(clip$.duration.get())
			if (Number.isFinite(start) && Number.isFinite(duration)) {
				intervals.push({
					id: clipId,
					trackId,
					trackKind,
					trackMuted,
					start,
					end: start + duration,
				})
			}
		}
	}

	intervals.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
	return intervals
}

export const createTimelineClipIntervals$ = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): Observable<TimelineClipInterval[]> =>
	computed(() => getTimelineClipIntervals$(projects$, getActiveProjectId$(projects$, session$)))

const getDeclaredPlaybackDuration$ = (
	projects$: Observable<ProjectRegistry>,
	projectId: EntityId | null,
): number | null => {
	const rootEntityId = getProjectRootEntityId$(projects$, projectId)
	if (!rootEntityId) {
		return null
	}

	const projectDuration = Number(projectEntityAttrs$(projects$, rootEntityId).duration.get())
	if (Number.isFinite(projectDuration) && projectDuration > 0) {
		return projectDuration
	}

	const timelineId = projectEntityRels$(projects$, rootEntityId).activeTimeline.get()
	if (typeof timelineId !== 'string') {
		return null
	}

	const timelineDuration = Number(attrs$<'timeline'>(projects$, timelineId).duration.get())
	return Number.isFinite(timelineDuration) && timelineDuration > 0 ? timelineDuration : null
}

export const createPlaybackDuration$ = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): Observable<number> => {
	const clipIntervals$ = createTimelineClipIntervals$(projects$, session$)

	return computed(() => {
		const declaredDuration = getDeclaredPlaybackDuration$(
			projects$,
			getActiveProjectId$(projects$, session$),
		)
		if (declaredDuration) {
			return declaredDuration
		}

		const clipEnd = clipIntervals$.get().reduce((maxEnd, clip) => Math.max(maxEnd, clip.end), 0)
		return clipEnd > 0 ? clipEnd : fallbackPlaybackDuration
	})
}

export const getActiveClipRefsAtCursor = (
	clipIntervals: TimelineClipInterval[],
	cursor: number,
): TimelineClipInterval[] => {
	const activeClips: TimelineClipInterval[] = []

	for (const clip of clipIntervals) {
		if (clip.start > cursor) {
			break
		}

		if (cursor >= clip.start && cursor < clip.end) {
			activeClips.push(clip)
		}
	}

	return activeClips
}

const getEffectFilter$ = (
	projects$: Observable<ProjectRegistry>,
	effectId: EntityId,
): string | null => {
	const effect$ = effectAttrs$(projects$, effectId)
	const kind = String(effect$.kind.get())
	const amount = Number(effect$.amount.get()) || 0

	if (kind === 'blur') {
		return `blur(${Math.round(amount * 10)}px)`
	}

	if (kind === 'sharpen') {
		return `contrast(${1 + amount}) saturate(${1 + amount * 0.5})`
	}

	if (kind === 'tint') {
		return `sepia(${amount}) saturate(${1 + amount})`
	}

	return null
}

const createKeyframeResolver = (
	projects$: Observable<ProjectRegistry>,
): ((id: EntityId) => ScalarKeyframe | null) =>
	(id) => {
		const keyframe$ = projects$.entitiesById[id]
		if (!keyframe$ || keyframe$.type.get() !== 'keyframe') {
			return null
		}

		const keyframeAttrs$ = attrs$<'keyframe'>(projects$, id) as Observable<KeyframeAttrs>
		const time = Number(keyframeAttrs$.time.get())
		const value = Number(keyframeAttrs$.value.get())
		return Number.isFinite(time) && Number.isFinite(value)
			? {
					time,
					value,
					interpolation: keyframeAttrs$.interpolation.get(),
				}
			: null
	}

const scalarValue = (scalar: AnimatedScalar | undefined, fallback: number): AnimatedScalar =>
	scalar ?? { value: fallback }

const resolveAnimatedScalar$ = (
	resolveKeyframe: (id: EntityId) => ScalarKeyframe | null,
	scalar: AnimatedScalar | undefined,
	fallback: number,
): ResolvedAnimatedScalar => {
	const normalizedScalar = scalarValue(scalar, fallback)
	const keyframes = normalizedScalar.keyframes
		?.map((keyframeId) => resolveKeyframe(keyframeId))
		.filter((keyframe): keyframe is ScalarKeyframe => keyframe !== null)

	return keyframes && keyframes.length > 0
		? { value: Number(normalizedScalar.value), keyframes }
		: { value: Number(normalizedScalar.value) }
}

const getPreviewClipSource$ = (
	projects$: Observable<ProjectRegistry>,
	clipRef: TimelineClipInterval,
): PreviewClipSource => {
	const clip$ = clipAttrs$(projects$, clipRef.id)
	const clipRels = clipRels$(projects$, clipRef.id)
	const resolveKeyframe = createKeyframeResolver(projects$)
	const start = Number(clip$.start.get())
	const duration = Number(clip$.duration.get())
	const resourceId = clipRels.resource.get()
	const resource$ = typeof resourceId === 'string'
		? resourceAttrs$(projects$, resourceId)
		: null
	const resourceKind = clipRef.trackKind === 'audio'
		? 'audio'
		: String(clip$.mediaKind.get() ?? resource$?.kind.get() ?? 'image') as ResourceAttrs['kind']
	const effectIds = clipRels.effects.get()
	const filters = Array.isArray(effectIds)
		? effectIds
				.map((effectId) => getEffectFilter$(projects$, effectId))
				.filter((filter): filter is string => Boolean(filter))
		: []
	const opacity = clip$.opacity.get()
	const transform = clip$.transform.get()

	return {
		id: clipRef.id,
		name: String(clip$.name.get()),
		color: String(clip$.color.get() ?? '#2563eb'),
		resourceName: resource$ ? String(resource$.name.get()) : String(clip$.name.get()),
		resourceKind,
		resourceUrl: resource$ ? String(resource$.url.get()) : '',
		mime: resource$ ? String(resource$.mime.get()) : '',
		inPoint: Number(clip$.in.get()),
		start,
		duration,
		fadeIn: Number(clip$.fadeIn.get() ?? 0),
		fadeOut: Number(clip$.fadeOut.get() ?? 0),
		opacity: resolveAnimatedScalar$(resolveKeyframe, opacity, 1),
		transform: {
			x: resolveAnimatedScalar$(resolveKeyframe, transform?.x, 0),
			y: resolveAnimatedScalar$(resolveKeyframe, transform?.y, 0),
			scale: resolveAnimatedScalar$(resolveKeyframe, transform?.scale, 1),
			rotation: resolveAnimatedScalar$(resolveKeyframe, transform?.rotation, 0),
		},
		audio: clip$.audio.get() ?? { gain: 1, pan: 0 },
		filters,
	}
}

export const renderPreviewClipSourceAtCursor = (
	clip: PreviewClipSource,
	cursor: number,
): RenderedClip | null => {
	if (cursor < clip.start || cursor >= clip.start + clip.duration) {
		return null
	}

	const localTime = Math.max(0, cursor - clip.start)
	const baseOpacity = evaluateKeyframedScalar(clip.opacity, localTime)

	return {
		id: clip.id,
		name: clip.name,
		color: clip.color,
		resourceName: clip.resourceName,
		resourceKind: clip.resourceKind,
		resourceUrl: clip.resourceUrl,
		mime: clip.mime,
		inPoint: clip.inPoint,
		start: clip.start,
		opacity: evaluateFadeOpacity(
			cursor,
			clip.start,
			clip.duration,
			baseOpacity,
			clip.fadeIn,
			clip.fadeOut,
		),
		transform: {
			x: evaluateKeyframedScalar(clip.transform.x, localTime),
			y: evaluateKeyframedScalar(clip.transform.y, localTime),
			scale: evaluateKeyframedScalar(clip.transform.scale, localTime),
			rotation: evaluateKeyframedScalar(clip.transform.rotation, localTime),
		},
		audio: clip.audio,
		filters: clip.filters,
	}
}

export const renderPreviewStructureAtCursor = (
	structure: PreviewStructure,
	cursor: number,
): RenderedClip[] => structure.clipSources
	.map((clip) => renderPreviewClipSourceAtCursor(clip, cursor))
	.filter((clip): clip is RenderedClip => clip !== null)

export const createPreviewFrame = (structure: PreviewStructure, cursor: number): PreviewFrame => {
	const renderedClips = renderPreviewStructureAtCursor(structure, cursor)
	return {
		cursor,
		renderedClips,
		visualRenderedClips: renderedClips.filter((clip) => clip.resourceKind !== 'audio'),
		audioRenderedClips: renderedClips.filter((clip) => clip.resourceKind === 'audio'),
		activeClipNames: renderedClips.map((clip) => clip.name),
	}
}

export const createPreviewFrame$ = (
	previewStructure$: Observable<PreviewStructure>,
	session$: Observable<EditorSessionState>,
): Observable<PreviewFrame> =>
	computed(() => createPreviewFrame(previewStructure$.get(), session$.cursor.get()))

export const createPreviewScene$ = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): Observable<PreviewScene> => {
	const previewStructure$ = createPreviewStructure$(projects$, session$)
	const previewFrame$ = createPreviewFrame$(previewStructure$, session$)
	const canvasClips$ = computed(() =>
		previewFrame$.get().renderedClips.map((clip) => ({
			name: clip.name,
			color: clip.color,
			kind: clip.resourceKind,
			opacity: clip.opacity,
		})),
	)

	return computed(() => {
		const frame = previewFrame$.get()
		return {
			cursor: frame.cursor,
			isPlaying: session$.isPlaying.get(),
			renderedClips: frame.renderedClips,
			visualRenderedClips: frame.visualRenderedClips,
			audioRenderedClips: frame.audioRenderedClips,
			activeClipNames: frame.activeClipNames,
			canvasClips: canvasClips$.get(),
		}
	})
}

export const createPreviewStructure$ = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): Observable<PreviewStructure> => {
	const clipIntervals$ = createTimelineClipIntervals$(projects$, session$)

	return computed(() => ({
		clipSources: clipIntervals$.get()
			.filter((clipRef) => !clipRef.trackMuted)
			.map((clipRef) => getPreviewClipSource$(projects$, clipRef)),
	}))
}

export const createTrackEnd$ = (
	projects$: Observable<ProjectRegistry>,
	trackId: EntityId,
): Observable<number> =>
	computed(() => getTrackClipIds$(projects$, trackId).reduce((maxEnd, clipId) => {
		const clip$ = clipAttrs$(projects$, clipId)
		const start = Number(clip$.start.get())
		const duration = Number(clip$.duration.get())
		return Number.isFinite(start) && Number.isFinite(duration)
			? Math.max(maxEnd, start + duration)
			: maxEnd
	}, 0))

export const createSelectedClipTrackPosition$ = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): Observable<SelectedClipTrackPosition | null> =>
	computed(() => {
		const selectedEntityId = session$.selectedEntityId.get()
		if (!selectedEntityId) {
			return null
		}

		const timelineId = getActiveTimelineId$(projects$, getActiveProjectId$(projects$, session$))
		const trackIds = getTimelineTrackIds$(projects$, timelineId)
		for (const trackId of trackIds) {
			const clipIds = getTrackClipIds$(projects$, trackId)
			const clipIndex = clipIds.indexOf(selectedEntityId)
			if (clipIndex >= 0) {
				return {
					trackId,
					trackName: String(trackAttrs$(projects$, trackId).name.get()),
					ordinal: clipIndex + 1,
				}
			}
		}

		return null
	})