import type { ResourceAttrs, ResourceKind } from './registryTypes'
import { evaluateFadeOpacity, evaluateKeyframedScalar } from './timing'
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

export interface ExportPlan {
	projectId: string
	fps: number
	width: number
	height: number
	duration: number
	clipSources: PreviewClipSource[]
}

export const normalizeExportPlan = (plan: ExportPlan): ExportPlan => {
	const maxClipEnd = plan.clipSources.reduce((maxEnd, clipSource) => {
		const start = Number.isFinite(clipSource.start) ? Math.max(0, clipSource.start) : 0
		const duration = Number.isFinite(clipSource.duration) ? Math.max(0, clipSource.duration) : 0
		return Math.max(maxEnd, start + duration)
	}, 0)
	return maxClipEnd > plan.duration
		? { ...plan, duration: maxClipEnd }
		: plan
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
