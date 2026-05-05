import { computed, type Observable } from '@legendapp/state'
import type {
	AnimatedScalar,
	EditorSessionState,
	EntityId,
	EffectAttrs,
	KeyframeAttrs,
	ProjectRegistry,
	ResourceAttrs,
	TextAttrs,
} from '../domain/types'
import { getEffectInstructionFilter, toEffectRenderInstruction, type EffectRenderInstruction } from '../render/colorPipeline'
import type { ScalarKeyframe } from '../render/timing'
import { createPreviewFrame, type PreviewClipSource, type PreviewFrame, type PreviewScene, type PreviewStructure, type ResolvedAnimatedScalar, type TimelineClipInterval } from '../read-model/previewComps'
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
	textAttrs$,
} from './observableSelectors'

export type { PreviewClipSource, PreviewFrame, PreviewScene, PreviewStructure, RenderedClip, ResolvedAnimatedScalar, TimelineClipInterval } from '../read-model/previewComps'
export { createPreviewFrame, renderPreviewClipSourceAtCursor, renderPreviewStructureAtCursor } from '../read-model/previewComps'

const fallbackPlaybackDuration = 20

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

const getEffectInstruction$ = (
	projects$: Observable<ProjectRegistry>,
	effectId: EntityId,
): EffectRenderInstruction | null =>
	toEffectRenderInstruction(effectAttrs$(projects$, effectId).get() as EffectAttrs)

const getTextPreviewAttrs$ = (
	projects$: Observable<ProjectRegistry>,
	textId: EntityId,
): TextAttrs => {
	const text$ = textAttrs$(projects$, textId)
	return {
		content: String(text$.content.get()),
		style: {
			fontFamily: String(text$.style.fontFamily.get()),
			fontSize: Number(text$.style.fontSize.get()),
			fontWeight: Number(text$.style.fontWeight.get()),
			lineHeight: Number(text$.style.lineHeight.get()),
			letterSpacing: Number(text$.style.letterSpacing.get()),
			color: String(text$.style.color.get()),
			backgroundColor: text$.style.backgroundColor.get(),
			align: text$.style.align.get(),
		},
		box: {
			width: Number(text$.box.width.get()),
			height: Number(text$.box.height.get()),
		},
	}
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
	const textId = clipRels.text.get()
	const resource$ = typeof resourceId === 'string'
		? resourceAttrs$(projects$, resourceId)
		: null
	const text = typeof textId === 'string' && projects$.entitiesById[textId]?.type.get() === 'text'
		? getTextPreviewAttrs$(projects$, textId)
		: null
	const resourceKind = clipRef.trackKind === 'audio'
		? 'audio'
		: String(clip$.mediaKind.get() ?? resource$?.kind.get() ?? 'image') as ResourceAttrs['kind']
	const effectIds = clipRels.effects.get()
	const effects = Array.isArray(effectIds)
		? effectIds
				.map((effectId) => getEffectInstruction$(projects$, effectId))
				.filter((effect): effect is EffectRenderInstruction => effect !== null)
		: []
	const filters = effects
		.map((effect) => getEffectInstructionFilter(effect))
		.filter((filter): filter is string => Boolean(filter))
	const opacity = clip$.opacity.get()
	const transform = clip$.transform.get()

	return {
		id: clipRef.id,
		resourceId: typeof resourceId === 'string' ? resourceId : null,
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
		effects,
		text,
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