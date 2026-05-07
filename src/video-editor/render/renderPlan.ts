import type { ClipAttrs, EffectAttrs, Entity, ProjectRegistry, ResourceAttrs, ResourceKind, TextAttrs } from './registryTypes'
import { getClipEntitiesForTrack, getTracks } from './registrySelectors'
import { evaluateAnimatedScalar, evaluateFadeOpacity, evaluateKeyframedScalar } from './timing'
import { toEffectRenderInstruction, type EffectRenderInstruction } from './colorPipeline'
import type { PreviewClipSource } from '../read-model/previewComps'

export interface ClipFrameOperation {
	clipId: string
	resourceId: string
	resourceKind: ResourceKind
	start: number
	duration: number
	localTime: number
	sourceTime: number
	operations: Array<{ type: 'transform' | 'effect' | 'opacity' | 'audio' | 'text', value: unknown }>
}

export interface EvaluatedTransformAttrs {
	x: number
	y: number
	scale: number
	rotation: number
}

export interface EditframeClip {
	type: 'ef-video' | 'ef-image' | 'ef-audio'
	id: string
	source: string
	start: number
	duration: number
	trimStart: number
	gain?: number
	pan?: number
}

const getEffectInstructions = (registry: ProjectRegistry, clip: Entity): EffectRenderInstruction[] => {
	const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
	return effectIds
		.map((effectId) => registry.entitiesById[effectId])
		.filter((effect): effect is Entity => Boolean(effect) && effect.type === 'effect')
		.map((effect) => toEffectRenderInstruction(effect.attrs as unknown as EffectAttrs))
}

const getEditframeType = (kind: ResourceAttrs['kind']): EditframeClip['type'] => {
	if (kind === 'video') {
		return 'ef-video'
	}
	if (kind === 'audio') {
		return 'ef-audio'
	}
	return 'ef-image'
}

export const compileClipFrameOperation = (registry: ProjectRegistry, clip: Entity, time?: number): ClipFrameOperation => {
	const attrs = clip.attrs as unknown as ClipAttrs
	const isTextClip = attrs.mediaKind === 'text' || typeof clip.rels.text === 'string'
	const resourceId = isTextClip ? String(clip.rels.text) : String(clip.rels.resource)
	const resource = isTextClip ? null : registry.entitiesById[resourceId]
	const resourceAttrs = resource?.attrs as ResourceAttrs | undefined
	const resourceKind: ResourceKind = isTextClip ? 'text' : attrs.mediaKind ?? resourceAttrs?.kind ?? 'image'
	const textAttrs = isTextClip ? registry.entitiesById[resourceId]?.attrs as unknown as TextAttrs | undefined : undefined
	const localTime = Math.max(0, (time ?? attrs.start) - attrs.start)
	const baseOpacity = evaluateAnimatedScalar(registry, attrs.opacity, localTime)
	const opacity = evaluateFadeOpacity(
		time ?? attrs.start,
		attrs.start,
		attrs.duration,
		baseOpacity,
		attrs.fadeIn ?? 0,
		attrs.fadeOut ?? 0,
	)
	const transform: EvaluatedTransformAttrs = {
		x: evaluateAnimatedScalar(registry, attrs.transform.x, localTime),
		y: evaluateAnimatedScalar(registry, attrs.transform.y, localTime),
		scale: evaluateAnimatedScalar(registry, attrs.transform.scale, localTime),
		rotation: evaluateAnimatedScalar(registry, attrs.transform.rotation, localTime),
	}

	return {
		clipId: clip.id,
		resourceId,
		resourceKind,
		start: attrs.start,
		duration: attrs.duration,
		localTime,
		sourceTime: attrs.in + localTime,
		operations: [
			{ type: 'transform', value: transform },
			...(textAttrs ? [{ type: 'text' as const, value: textAttrs }] : []),
			...getEffectInstructions(registry, clip).map((effect) => ({ type: 'effect' as const, value: effect })),
			{ type: 'opacity', value: opacity },
			...(resourceKind === 'audio'
				? [{ type: 'audio' as const, value: attrs.audio ?? { gain: 1, pan: 0 } }]
				: []),
		],
	}
}

export const compileFrameOperations = (
	registry: ProjectRegistry,
	projectId: string,
	time: number,
): ClipFrameOperation[] => {
	const project = registry.projects[projectId]
	return getTracks(registry, project)
		.filter((track) => track.attrs.muted !== true)
		.flatMap((track) => getClipEntitiesForTrack(registry, track.id))
		.filter((clip) => {
			const attrs = clip.attrs as unknown as ClipAttrs
			return time >= attrs.start && time < attrs.start + attrs.duration
		})
		.map((clip) => compileClipFrameOperation(registry, clip, time))
}

export const compileEditframeClips = (registry: ProjectRegistry, projectId: string): EditframeClip[] => {
	const project = registry.projects[projectId]
	return getTracks(registry, project)
		.filter((track) => track.attrs.muted !== true)
		.flatMap((track) => getClipEntitiesForTrack(registry, track.id))
		.filter((clip) => (clip.attrs as unknown as ClipAttrs).mediaKind !== 'text')
		.map((clip) => {
			const attrs = clip.attrs as unknown as ClipAttrs
			const resourceId = String(clip.rels.resource)
			const resourceAttrs = registry.entitiesById[resourceId].attrs as unknown as ResourceAttrs
			const resourceKind = attrs.mediaKind ?? resourceAttrs.kind

			return {
				type: getEditframeType(resourceKind),
				id: clip.id,
				source: resourceAttrs.url,
				start: attrs.start,
				duration: attrs.duration,
				trimStart: attrs.in,
				...(resourceKind === 'audio' ? { gain: attrs.audio?.gain ?? 1, pan: attrs.audio?.pan ?? 0 } : {}),
			}
		})
}

// ---------------------------------------------------------------------------
// Plan-based render functions (no registry)
// ---------------------------------------------------------------------------

export interface ExportPlan {
	projectId: string
	fps: number
	width: number
	height: number
	duration: number
	clipSources: PreviewClipSource[]
}

export const compileClipFrameOperationFromSource = (
	source: PreviewClipSource,
	time: number,
): ClipFrameOperation => {
	const localTime = Math.max(0, time - source.start)
	const baseOpacity = evaluateKeyframedScalar(source.opacity, localTime)
	const opacity = evaluateFadeOpacity(time, source.start, source.duration, baseOpacity, source.fadeIn, source.fadeOut)
	const transform: EvaluatedTransformAttrs = {
		x: evaluateKeyframedScalar(source.transform.x, localTime),
		y: evaluateKeyframedScalar(source.transform.y, localTime),
		scale: evaluateKeyframedScalar(source.transform.scale, localTime),
		rotation: evaluateKeyframedScalar(source.transform.rotation, localTime),
	}
	return {
		clipId: source.id,
		resourceId: source.resourceId ?? source.id,
		resourceKind: source.resourceKind,
		start: source.start,
		duration: source.duration,
		localTime,
		sourceTime: source.inPoint + localTime,
		operations: [
			{ type: 'transform', value: transform },
			...(source.text ? [{ type: 'text' as const, value: source.text }] : []),
			...source.effects.map((effect) => ({ type: 'effect' as const, value: effect })),
			{ type: 'opacity', value: opacity },
			...(source.resourceKind === 'audio' ? [{ type: 'audio' as const, value: source.audio }] : []),
		],
	}
}

export const compileFrameOperationsFromPlan = (
	plan: ExportPlan,
	time: number,
): ClipFrameOperation[] =>
	plan.clipSources
		.filter((s) => time >= s.start && time < s.start + s.duration)
		.map((s) => compileClipFrameOperationFromSource(s, time))

const getEditframeTypeFromKind = (kind: ResourceAttrs['kind']): EditframeClip['type'] => {
	if (kind === 'video') return 'ef-video'
	if (kind === 'audio') return 'ef-audio'
	return 'ef-image'
}

export const compileEditframeClipsFromPlan = (plan: ExportPlan): EditframeClip[] =>
	plan.clipSources
		.filter((s) => s.resourceKind !== 'text')
		.map((s) => ({
			type: getEditframeTypeFromKind(s.resourceKind),
			id: s.id,
			source: s.resourceUrl,
			start: s.start,
			duration: s.duration,
			trimStart: s.inPoint,
			...(s.resourceKind === 'audio' ? { gain: s.audio.gain, pan: s.audio.pan } : {}),
		}))
