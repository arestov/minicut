import type { AnimatedScalar, EntityId, KeyframeAttrs, ProjectRegistry } from '../domain/types'

export interface ScalarKeyframe extends KeyframeAttrs {
	time: number
	value: number
}

type ScalarKeyframeRef = ScalarKeyframe | EntityId

interface KeyframedScalarInput {
	value: number
	keyframes?: readonly ScalarKeyframeRef[]
}

export const interpolateLinear = (from: number, to: number, progress: number): number =>
	from + (to - from) * Math.min(1, Math.max(0, progress))

const isScalarKeyframe = (value: ScalarKeyframeRef): value is ScalarKeyframe =>
	typeof value === 'object' && value !== null && Number.isFinite(value.time) && Number.isFinite(value.value)

export const getScalarKeyframeEntities = (
	registry: ProjectRegistry,
	scalar: AnimatedScalar,
): ScalarKeyframe[] => (scalar.keyframes ?? [])
	.map((keyframeId) => {
		const entity = registry.entitiesById[keyframeId]
		if (!entity || entity.type !== 'keyframe') {
			return null
		}

		const attrs = entity.attrs as unknown as KeyframeAttrs
		return Number.isFinite(attrs.time) && Number.isFinite(attrs.value)
			? { time: attrs.time, value: attrs.value, interpolation: attrs.interpolation }
			: null
	})
	.filter((keyframe): keyframe is ScalarKeyframe => keyframe !== null)

export const evaluateKeyframedScalar = (
	scalar: KeyframedScalarInput,
	time: number,
	resolveKeyframe?: (id: EntityId) => ScalarKeyframe | null,
): number => {
	const keyframes = scalar.keyframes
		?.map((keyframe) => {
			if (isScalarKeyframe(keyframe)) {
				return keyframe
			}

			return resolveKeyframe?.(keyframe) ?? null
		})
		.filter((keyframe): keyframe is ScalarKeyframe => keyframe !== null && Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value)) ?? []
	if (keyframes.length === 0) {
		return scalar.value
	}

	const sorted = [...keyframes].sort((a, b) => a.time - b.time)
	if (time <= sorted[0].time) {
		return sorted[0].value
	}

	const last = sorted[sorted.length - 1]
	if (time >= last.time) {
		return last.value
	}

	for (let index = 0; index < sorted.length - 1; index += 1) {
		const from = sorted[index]
		const to = sorted[index + 1]
		if (time >= from.time && time <= to.time) {
			if (from.interpolation === 'hold' || from.time === to.time) {
				return from.interpolation === 'hold' ? from.value : to.value
			}

			return interpolateLinear(from.value, to.value, (time - from.time) / (to.time - from.time))
		}
	}

	return scalar.value
}

export const evaluateAnimatedScalar = (
	registry: ProjectRegistry,
	scalar: AnimatedScalar,
	time: number,
): number => evaluateKeyframedScalar(scalar, time, (keyframeId) => {
	const entity = registry.entitiesById[keyframeId]
	if (!entity || entity.type !== 'keyframe') {
		return null
	}

	const attrs = entity.attrs as unknown as KeyframeAttrs
	return Number.isFinite(attrs.time) && Number.isFinite(attrs.value)
		? { time: attrs.time, value: attrs.value, interpolation: attrs.interpolation }
		: null
})

export const evaluateFadeOpacity = (
	time: number,
	clipStart: number,
	clipDuration: number,
	baseOpacity: number,
	fadeInDuration = 0,
	fadeOutDuration = 0,
): number => {
	if (time < clipStart || time >= clipStart + clipDuration) {
		return 0
	}

	const localTime = time - clipStart
	const fadeInMultiplier = fadeInDuration > 0
		? Math.min(1, Math.max(0, localTime / fadeInDuration))
		: 1
	const fadeOutStart = clipDuration - fadeOutDuration
	const fadeOutMultiplier = fadeOutDuration > 0 && localTime > fadeOutStart
		? Math.min(1, Math.max(0, (clipDuration - localTime) / fadeOutDuration))
		: 1

	return baseOpacity * Math.min(fadeInMultiplier, fadeOutMultiplier)
}
