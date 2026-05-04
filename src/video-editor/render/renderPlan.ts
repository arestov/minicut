import type { ClipAttrs, EffectAttrs, Entity, ProjectRegistry, ResourceAttrs, ResourceKind, TextAttrs } from '../domain/types'
import { getClipEntitiesForTrack, getTracks } from '../domain/selectors'
import { evaluateAnimatedScalar, evaluateFadeOpacity } from './timing'
import { toEffectRenderInstruction, type EffectRenderInstruction } from './colorPipeline'

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
