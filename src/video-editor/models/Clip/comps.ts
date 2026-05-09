import type { PreviewClipSource, ResolvedAnimatedScalar } from '../../read-model/previewComps'
import { mergeEffectFilters, type EffectRenderInstruction } from '../../render/colorPipeline'
import { defaultClipTransform } from './actions'

export const reduceClipRenderData = (
	sourceClipId: unknown,
	sourceResourceId: unknown,
	sourceResourceName: unknown,
	mediaKind: unknown,
	name: unknown,
	color: unknown,
	start: unknown,
	inPoint: unknown,
	duration: unknown,
	fadeIn: unknown,
	fadeOut: unknown,
	opacity: unknown,
	transform: unknown,
	audio: unknown,
	effectInstructions: unknown,
	textAttrs: unknown,
	resourceSummary: unknown,
): PreviewClipSource => {
	const effects: EffectRenderInstruction[] = Array.isArray(effectInstructions)
		? (effectInstructions.flat().filter(Boolean) as EffectRenderInstruction[])
		: []
	const filters = mergeEffectFilters(effects)
	const res = resourceSummary && typeof resourceSummary === 'object'
		? resourceSummary as { name: string; kind: string; url: string; mime: string }
		: null
	const asNum = (v: unknown, fb: number): number => typeof v === 'number' && Number.isFinite(v) ? v : fb
	const asStr = (v: unknown, fb: string): string => typeof v === 'string' ? v : fb
	const asAnimScalar = (v: unknown, fb: number): ResolvedAnimatedScalar => {
		if (v && typeof v === 'object' && 'value' in v) return v as ResolvedAnimatedScalar
		return { value: typeof v === 'number' ? v : fb }
	}
	const asTransform = (v: unknown) => {
		const t = v && typeof v === 'object' ? v as Record<string, unknown> : defaultClipTransform
		return {
			x: asAnimScalar(t.x, 0),
			y: asAnimScalar(t.y, 0),
			scale: asAnimScalar(t.scale, 1),
			rotation: asAnimScalar(t.rotation, 0),
		}
	}
	return {
		id: asStr(sourceClipId, ''),
		resourceId: typeof sourceResourceId === 'string' ? sourceResourceId : null,
		name: asStr(name, 'Clip'),
		color: asStr(color, '#2563eb'),
		resourceName: res?.name ?? asStr(sourceResourceName ?? name, 'Clip'),
		resourceKind: asStr(mediaKind ?? res?.kind, 'video') as PreviewClipSource['resourceKind'],
		resourceUrl: res?.url ?? '',
		mime: res?.mime ?? 'application/octet-stream',
		inPoint: asNum(inPoint, 0),
		start: asNum(start, 0),
		duration: asNum(duration, 0),
		fadeIn: asNum(fadeIn, 0),
		fadeOut: asNum(fadeOut, 0),
		opacity: asAnimScalar(opacity, 1),
		transform: asTransform(transform),
		audio: audio && typeof audio === 'object' ? audio as { gain: number; pan: number } : { gain: 1, pan: 0 },
		filters: filters ? [filters] : [],
		effects,
		text: textAttrs && typeof textAttrs === 'object' ? textAttrs as PreviewClipSource['text'] : null,
	}
}
