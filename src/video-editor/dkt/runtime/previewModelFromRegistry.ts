import {
	getActiveProject,
	getClipEntitiesForTrack,
	getProjectEntity,
	getTracks,
} from '../../domain/selectors'
import type { AnimatedScalar, EffectAttrs, Entity, EntityId, ProjectRegistry, ResourceAttrs, TextAttrs } from '../../domain/types'
import { getEffectInstructionFilter, toEffectRenderInstruction, type EffectRenderInstruction } from '../../render/colorPipeline'
import type { ScalarKeyframe } from '../../render/timing'
import { createPreviewFrame, type PreviewClipSource, type PreviewFrame, type PreviewStructure, type ResolvedAnimatedScalar, type TimelineClipInterval } from '../../read-model/previewComps'

export interface SelectedClipTrackPosition {
	trackId: EntityId
	trackName: string
	ordinal: number
}

export interface SelectedClipSummary {
	color: string
	resourceName: string
	trackName: string
}

const asResourceKind = (value: unknown): ResourceAttrs['kind'] => (
	value === 'audio' || value === 'image' || value === 'text' || value === 'video' ? value : 'image'
)

const asEntityIds = (value: unknown): EntityId[] => Array.isArray(value) ? value.filter((id): id is EntityId => typeof id === 'string') : []

const resolveAnimatedScalar = (
	resolveKeyframe: (id: EntityId) => ScalarKeyframe | null,
	scalar: AnimatedScalar | undefined,
	fallback: number,
): ResolvedAnimatedScalar => {
	const normalizedScalar = scalar ?? { value: fallback }
	const keyframes = normalizedScalar.keyframes
		?.map((keyframeId) => resolveKeyframe(keyframeId))
		.filter((keyframe): keyframe is ScalarKeyframe => keyframe !== null)

	return keyframes && keyframes.length > 0
		? { value: Number(normalizedScalar.value), keyframes }
		: { value: Number(normalizedScalar.value) }
}

const getTextPreviewAttrs = (text: Entity): TextAttrs => {
	const attrs = text.attrs as Partial<TextAttrs>
	const style = attrs.style ?? {}
	const box = attrs.box ?? {}

	return {
		content: String(attrs.content ?? ''),
		style: {
			fontFamily: String(style.fontFamily ?? 'Inter'),
			fontSize: Number(style.fontSize ?? 32),
			fontWeight: Number(style.fontWeight ?? 700),
			lineHeight: Number(style.lineHeight ?? 1.2),
			letterSpacing: Number(style.letterSpacing ?? 0),
			color: String(style.color ?? '#ffffff'),
			backgroundColor: style.backgroundColor,
			align: style.align ?? 'center',
		},
		box: {
			width: Number(box.width ?? 640),
			height: Number(box.height ?? 180),
		},
	}
}

const createKeyframeResolver = (registry: ProjectRegistry): ((id: EntityId) => ScalarKeyframe | null) =>
	(id) => {
		const keyframe = registry.entitiesById[id]
		if (!keyframe || keyframe.type !== 'keyframe') {
			return null
		}

		const attrs = keyframe.attrs as Record<string, unknown>
		const time = Number(attrs.time)
		const value = Number(attrs.value)
		return Number.isFinite(time) && Number.isFinite(value)
			? {
				time,
				value,
				interpolation: attrs.interpolation === 'hold' || attrs.interpolation === 'ease' ? attrs.interpolation : 'linear',
			}
			: null
	}

const getEffectInstruction = (effect: Entity | undefined): EffectRenderInstruction | null =>
	effect ? toEffectRenderInstruction(effect.attrs as EffectAttrs) : null

const getPreviewClipSource = (
	registry: ProjectRegistry,
	clipRef: TimelineClipInterval,
): PreviewClipSource => {
	const clip = registry.entitiesById[clipRef.id]
	const attrs = clip.attrs as Record<string, unknown>
	const rels = clip.rels as Record<string, unknown>
	const resourceId = typeof rels.resource === 'string' ? rels.resource : null
	const textId = typeof rels.text === 'string' ? rels.text : null
	const resource = resourceId ? registry.entitiesById[resourceId] : null
	const text = textId ? registry.entitiesById[textId] : null
	const resourceAttrs = resource?.attrs as Record<string, unknown> | undefined
	const transform = attrs.transform as PreviewClipSource['transform'] | undefined
	const effects = asEntityIds(rels.effects)
		.map((effectId) => getEffectInstruction(registry.entitiesById[effectId]))
		.filter((effect): effect is EffectRenderInstruction => effect !== null)
	const filters = effects
		.map((effect) => getEffectInstructionFilter(effect))
		.filter((filter): filter is string => Boolean(filter))
	const resolveKeyframe = createKeyframeResolver(registry)
	const resourceKind = clipRef.trackKind === 'audio'
		? 'audio'
		: asResourceKind(attrs.mediaKind ?? resourceAttrs?.kind)

	return {
		id: clipRef.id,
		resourceId,
		name: String(attrs.name ?? 'Clip'),
		color: String(attrs.color ?? '#2563eb'),
		resourceName: resourceAttrs ? String(resourceAttrs.name ?? attrs.name ?? 'Clip') : String(attrs.name ?? 'Clip'),
		resourceKind,
		resourceUrl: resourceAttrs ? String(resourceAttrs.url ?? '') : '',
		mime: resourceAttrs ? String(resourceAttrs.mime ?? '') : '',
		inPoint: Number(attrs.in ?? 0),
		start: Number(attrs.start ?? 0),
		duration: Number(attrs.duration ?? 0),
		fadeIn: Number(attrs.fadeIn ?? 0),
		fadeOut: Number(attrs.fadeOut ?? 0),
		opacity: resolveAnimatedScalar(resolveKeyframe, attrs.opacity as AnimatedScalar | undefined, 1),
		transform: {
			x: resolveAnimatedScalar(resolveKeyframe, transform?.x as AnimatedScalar | undefined, 0),
			y: resolveAnimatedScalar(resolveKeyframe, transform?.y as AnimatedScalar | undefined, 0),
			scale: resolveAnimatedScalar(resolveKeyframe, transform?.scale as AnimatedScalar | undefined, 1),
			rotation: resolveAnimatedScalar(resolveKeyframe, transform?.rotation as AnimatedScalar | undefined, 0),
		},
		audio: (attrs.audio as PreviewClipSource['audio'] | undefined) ?? { gain: 1, pan: 0 },
		filters,
		effects,
		text: text?.type === 'text' ? getTextPreviewAttrs(text) : null,
	}
}

export const createPreviewStructureFromRegistry = (
	registry: ProjectRegistry,
	activeProjectId: string | null,
): PreviewStructure => {
	const project = getActiveProject(registry, { activeProjectId })
	if (!project) {
		return { clipSources: [] }
	}

	const projectEntity = getProjectEntity(registry, project)
	const resourceIds = new Set(asEntityIds(projectEntity.rels.resources))
	const clipRefs: TimelineClipInterval[] = []
	for (const track of getTracks(registry, project)) {
		const trackKind = asResourceKind(track.attrs.kind)
		const trackMuted = track.attrs.muted === true
		for (const clip of getClipEntitiesForTrack(registry, track.id)) {
			const attrs = clip.attrs as Record<string, unknown>
			const start = Number(attrs.start ?? 0)
			const duration = Number(attrs.duration ?? 0)
			if (!Number.isFinite(start) || !Number.isFinite(duration)) {
				continue
			}

			clipRefs.push({
				id: clip.id,
				trackId: track.id,
				trackKind,
				trackMuted,
				start,
				end: start + duration,
			})
		}
	}

	clipRefs.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
	return {
		clipSources: clipRefs
			.filter((clipRef) => !clipRef.trackMuted)
			.filter((clipRef) => {
				const resourceId = registry.entitiesById[clipRef.id]?.rels.resource
				return typeof resourceId !== 'string' || resourceIds.has(resourceId)
			})
			.map((clipRef) => getPreviewClipSource(registry, clipRef)),
	}
}

export const createPreviewFrameFromRegistry = (
	registry: ProjectRegistry,
	activeProjectId: string | null,
	cursor: number,
): { structure: PreviewStructure; frame: PreviewFrame } => {
	const structure = createPreviewStructureFromRegistry(registry, activeProjectId)
	return { structure, frame: createPreviewFrame(structure, cursor) }
}

export const createSelectedClipTrackPositionFromRegistry = (
	registry: ProjectRegistry,
	activeProjectId: string | null,
	selectedEntityId: string | null,
): SelectedClipTrackPosition | null => {
	if (!selectedEntityId) {
		return null
	}

	const project = getActiveProject(registry, { activeProjectId })
	if (!project) {
		return null
	}

	for (const track of getTracks(registry, project)) {
		const clipIds = asEntityIds(track.rels.clips)
		const clipIndex = clipIds.indexOf(selectedEntityId)
		if (clipIndex >= 0) {
			return {
				trackId: track.id,
				trackName: String(track.attrs.name ?? 'Track'),
				ordinal: clipIndex + 1,
			}
		}
	}

	return null
}

export const createSelectedClipSummaryFromRegistry = (
	registry: ProjectRegistry,
	activeProjectId: string | null,
	selectedEntityId: string | null,
): SelectedClipSummary | null => {
	const position = createSelectedClipTrackPositionFromRegistry(registry, activeProjectId, selectedEntityId)
	if (!position || !selectedEntityId) {
		return null
	}

	const clip = registry.entitiesById[selectedEntityId]
	if (!clip || clip.type !== 'clip') {
		return null
	}

	const resourceId = typeof clip.rels.resource === 'string' ? clip.rels.resource : null
	const resource = resourceId ? registry.entitiesById[resourceId] : null
	return {
		color: String(clip.attrs.color ?? '#2563eb'),
		resourceName: String(resource?.attrs.name ?? clip.attrs.name ?? 'Selected clip'),
		trackName: position.trackName,
	}
}