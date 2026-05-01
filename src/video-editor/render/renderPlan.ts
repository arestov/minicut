import type { ClipAttrs, Entity, ProjectRegistry, ResourceAttrs } from '../domain/types'
import { getClipEntitiesForTrack, getTracks } from '../domain/selectors'

export interface ClipFrameOperation {
	clipId: string
	resourceId: string
	resourceKind: ResourceAttrs['kind']
	start: number
	duration: number
	operations: Array<{ type: 'transform' | 'effect' | 'opacity', value: unknown }>
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

export const compileClipFrameOperation = (registry: ProjectRegistry, clip: Entity): ClipFrameOperation => {
	const attrs = clip.attrs as unknown as ClipAttrs
	const resourceId = String(clip.rels.resource)
	const resource = registry.entitiesById[resourceId]
	const resourceAttrs = resource.attrs as unknown as ResourceAttrs

	return {
		clipId: clip.id,
		resourceId,
		resourceKind: resourceAttrs.kind,
		start: attrs.start,
		duration: attrs.duration,
		operations: [
			{ type: 'transform', value: attrs.transform },
			...getEffectNames(registry, clip).map((effect) => ({ type: 'effect' as const, value: effect })),
			{ type: 'opacity', value: attrs.opacity.value },
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
		.map((clip) => compileClipFrameOperation(registry, clip))
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
