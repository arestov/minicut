import type { EntityId, ResourceAttrs } from '../render/registryTypes'
import type { TextAttrs } from '../models/Text/types'
import type { EffectRenderInstruction } from '../render/colorPipeline'
import type { ScalarKeyframe } from '../render/timing'
import { evaluateFadeOpacity, evaluateKeyframedScalar } from '../render/timing'

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
	resourceId: string | null
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
	effects: EffectRenderInstruction[]
	text: TextAttrs | null
}

export interface ResolvedAnimatedScalar {
	value: number
	keyframes?: ScalarKeyframe[]
}

export interface PreviewClipSource {
	id: string
	resourceId: string | null
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
	effects: EffectRenderInstruction[]
	text: TextAttrs | null
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
		resourceId: clip.resourceId,
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
		effects: clip.effects,
		text: clip.text,
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
