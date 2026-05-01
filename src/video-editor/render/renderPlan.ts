import type { ClipAttrs, Entity, ProjectRegistry, ResourceAttrs } from '../domain/types'
import { getClipEntitiesForTrack, getTracks } from '../domain/selectors'
import { evaluateAnimatedScalar, evaluateFadeOpacity } from './timing'

export interface ClipFrameOperation {
	clipId: string
	resourceId: string
	resourceKind: ResourceAttrs['kind']
	start: number
	duration: number
	localTime: number
	sourceTime: number
	operations: Array<{ type: 'transform' | 'effect' | 'opacity', value: unknown }>
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
}

const getEffectNames = (registry: ProjectRegistry, clip: Entity): string[] => {
	const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
	return effectIds.map((effectId) => String(registry.entitiesById[effectId].attrs.kind))
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
	const resourceId = String(clip.rels.resource)
	const resource = registry.entitiesById[resourceId]
	const resourceAttrs = resource.attrs as unknown as ResourceAttrs
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
		resourceKind: resourceAttrs.kind,
		start: attrs.start,
		duration: attrs.duration,
		localTime,
		sourceTime: attrs.in + localTime,
		operations: [
			{ type: 'transform', value: transform },
			...getEffectNames(registry, clip).map((effect) => ({ type: 'effect' as const, value: effect })),
			{ type: 'opacity', value: opacity },
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
		.flatMap((track) => getClipEntitiesForTrack(registry, track.id))
		.map((clip) => {
			const attrs = clip.attrs as unknown as ClipAttrs
			const resourceId = String(clip.rels.resource)
			const resourceAttrs = registry.entitiesById[resourceId].attrs as unknown as ResourceAttrs

			return {
				type: getEditframeType(resourceAttrs.kind),
				id: clip.id,
				source: resourceAttrs.url,
				start: attrs.start,
				duration: attrs.duration,
				trimStart: attrs.in,
			}
		})
}
