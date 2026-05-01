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
		const trackKind = String(trackAttrs$(projects$, trackId).kind.get()) as ResourceAttrs['kind']
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

const sameTimelineClipInterval = (
	left: TimelineClipInterval,
	right: TimelineClipInterval,
): boolean =>
	left.id === right.id
	&& left.trackId === right.trackId
	&& left.trackKind === right.trackKind
	&& left.start === right.start
	&& left.end === right.end

const sameTimelineClipIntervalList = (
	left: TimelineClipInterval[],
	right: TimelineClipInterval[],
): boolean => {
	if (left.length !== right.length) {
		return false
	}

	for (let index = 0; index < left.length; index += 1) {
		if (!sameTimelineClipInterval(left[index], right[index])) {
			return false
		}
	}

	return true
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

const getRenderedClip$ = (
	projects$: Observable<ProjectRegistry>,
	clipRef: TimelineClipInterval,
	cursor: number,
	resolveKeyframe: (id: EntityId) => ScalarKeyframe | null,
): RenderedClip => {
	const clip$ = clipAttrs$(projects$, clipRef.id)
	const clipRels = clipRels$(projects$, clipRef.id)
	const start = Number(clip$.start.get())
	const duration = Number(clip$.duration.get())
	const localTime = Math.max(0, cursor - start)
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
	const baseOpacity = evaluateKeyframedScalar(
		scalarValue(opacity, 1),
		localTime,
		resolveKeyframe,
	)

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
		opacity: evaluateFadeOpacity(
			cursor,
			start,
			duration,
			baseOpacity,
			Number(clip$.fadeIn.get() ?? 0),
			Number(clip$.fadeOut.get() ?? 0),
		),
		transform: {
			x: evaluateKeyframedScalar(scalarValue(transform?.x, 0), localTime, resolveKeyframe),
			y: evaluateKeyframedScalar(scalarValue(transform?.y, 0), localTime, resolveKeyframe),
			scale: evaluateKeyframedScalar(scalarValue(transform?.scale, 1), localTime, resolveKeyframe),
			rotation: evaluateKeyframedScalar(scalarValue(transform?.rotation, 0), localTime, resolveKeyframe),
		},
		audio: clip$.audio.get() ?? { gain: 1, pan: 0 },
		filters,
	}
}

export const createPreviewScene$ = (
	projects$: Observable<ProjectRegistry>,
	session$: Observable<EditorSessionState>,
): Observable<PreviewScene> => {
	const clipIntervals$ = createTimelineClipIntervals$(projects$, session$)
	let previousActiveClipRefs: TimelineClipInterval[] = []
	const activeClipRefs$ = computed(() => {
		const nextClipRefs = getActiveClipRefsAtCursor(clipIntervals$.get(), session$.cursor.get())
		if (sameTimelineClipIntervalList(previousActiveClipRefs, nextClipRefs)) {
			return previousActiveClipRefs
		}

		previousActiveClipRefs = nextClipRefs
		return nextClipRefs
	})
	const renderedClips$ = computed(() => {
		const cursor = session$.cursor.get()
		const resolveKeyframe = createKeyframeResolver(projects$)
		return activeClipRefs$.get().map((clipRef) =>
			getRenderedClip$(projects$, clipRef, cursor, resolveKeyframe),
		)
	})
	const visualRenderedClips$ = computed(() =>
		renderedClips$.get().filter((clip) => clip.resourceKind !== 'audio'),
	)
	const audioRenderedClips$ = computed(() =>
		renderedClips$.get().filter((clip) => clip.resourceKind === 'audio'),
	)
	const activeClipNames$ = computed(() => renderedClips$.get().map((clip) => clip.name))
	const canvasClips$ = computed(() =>
		renderedClips$.get().map((clip) => ({
			name: clip.name,
			color: clip.color,
			kind: clip.resourceKind,
			opacity: clip.opacity,
		})),
	)

	return computed(() => {
		return {
			cursor: session$.cursor.get(),
			isPlaying: session$.isPlaying.get(),
			renderedClips: renderedClips$.get(),
			visualRenderedClips: visualRenderedClips$.get(),
			audioRenderedClips: audioRenderedClips$.get(),
			activeClipNames: activeClipNames$.get(),
			canvasClips: canvasClips$.get(),
		}
	})
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