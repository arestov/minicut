import { getClipEntitiesForTrack, getTracks } from './registrySelectors'
import type { ClipAttrs, Entity, ProjectRegistry, ResourceAttrs, ResourceKind, TextAttrs } from './registryTypes'
import type { EffectRenderInstruction } from './colorPipeline'
import { compileClipFrameOperation, type EvaluatedTransformAttrs } from './renderPlan'

export interface DebugRenderViewport {
	width: number
	height: number
}

export interface DrawCall {
	clipId: string
	trackId: string
	trackIndex: number
	resourceKind: ResourceKind
	x: number
	y: number
	width: number
	height: number
	scale: number
	rotation: number
	opacity: number
	effects: string[]
	sourceTime: number
}

const defaultViewport: DebugRenderViewport = {
	width: 1920,
	height: 1080,
}

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const getOperationValue = <Value>(
	operations: Array<{ type: string; value: unknown }>,
	type: string,
	fallback: Value,
): Value => operations.find((operation) => operation.type === type)?.value as Value ?? fallback

const finiteOr = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback

const getEffectKind = (value: unknown): string => {
	if (value && typeof value === 'object' && 'kind' in value) {
		return String((value as EffectRenderInstruction).kind)
	}

	return String(value)
}


type DebugSourceAttrs = Pick<ResourceAttrs, 'kind' | 'width' | 'height'>

const getSourceAttrs = (registry: ProjectRegistry, clip: Entity): DebugSourceAttrs => {
	const clipAttrs = clip.attrs as unknown as ClipAttrs
	if (clipAttrs.mediaKind === 'text' && typeof clip.rels.text === 'string') {
		const textAttrs = registry.entitiesById[clip.rels.text]?.attrs as unknown as TextAttrs | undefined
		return { kind: 'text', width: textAttrs?.box.width, height: textAttrs?.box.height }
	}

	const resourceId = String(clip.rels.resource)
	const resource = registry.entitiesById[resourceId]
	return resource.attrs as unknown as ResourceAttrs
}

const getDrawBounds = (
	resourceAttrs: DebugSourceAttrs,
	transform: EvaluatedTransformAttrs,
	viewport: DebugRenderViewport,
): Pick<DrawCall, 'x' | 'y' | 'width' | 'height' | 'scale' | 'rotation'> => {
	const scale = Math.max(0, finiteOr(transform.scale, 1))
	const sourceWidth = finiteOr(Number(resourceAttrs.width), viewport.width)
	const sourceHeight = finiteOr(Number(resourceAttrs.height), viewport.height)
	const width = sourceWidth * scale
	const height = sourceHeight * scale

	return {
		x: (viewport.width - width) / 2 + finiteOr(transform.x, 0),
		y: (viewport.height - height) / 2 + finiteOr(transform.y, 0),
		width,
		height,
		scale,
		rotation: finiteOr(transform.rotation, 0),
	}
}

export const renderFrameDebug = (
	registry: ProjectRegistry,
	projectId: string,
	time: number,
	viewport: DebugRenderViewport = defaultViewport,
): DrawCall[] => {
	const project = registry.projects[projectId]
	if (!project) {
		throw new Error(`Unknown project ${projectId}`)
	}

	return getTracks(registry, project).flatMap((track, trackIndex) =>
		getClipEntitiesForTrack(registry, track.id).flatMap((clip): DrawCall[] => {
			const attrs = clip.attrs as unknown as ClipAttrs
			if (time < attrs.start || time >= attrs.start + attrs.duration) {
				return []
			}

			const frameOperation = compileClipFrameOperation(registry, clip, time)
			const transform = getOperationValue<EvaluatedTransformAttrs>(
				frameOperation.operations,
				'transform',
				{ x: 0, y: 0, scale: 1, rotation: 0 },
			)
			const resourceAttrs = getSourceAttrs(registry, clip)
			const opacity = clamp(finiteOr(Number(getOperationValue(frameOperation.operations, 'opacity', 1)), 1), 0, 1)
			const effects = frameOperation.operations
				.filter((operation) => operation.type === 'effect')
				.map((operation) => getEffectKind(operation.value))

			return [{
				clipId: clip.id,
				trackId: track.id,
				trackIndex,
				resourceKind: resourceAttrs.kind,
				...getDrawBounds(resourceAttrs, transform, viewport),
				opacity,
				effects,
				sourceTime: frameOperation.sourceTime,
			}]
		}),
	)
}

export const getDebugFramePixelSignature = (calls: DrawCall[]): number =>
	Math.round(calls.reduce((sum, call, index) => {
		const effectWeight = call.effects.reduce((effectSum, effect) =>
			effectSum + [...effect].reduce((charSum, char) => charSum + char.charCodeAt(0), 0),
		0)
		return sum + (index + 1) * call.width * call.height * call.opacity + effectWeight
	}, 0))
