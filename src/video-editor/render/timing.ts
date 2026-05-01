import type { AnimatedScalar } from '../domain/types'

export interface ScalarKeyframe {
	time: number
	value: number
}

export const interpolateLinear = (from: number, to: number, progress: number): number =>
	from + (to - from) * Math.min(1, Math.max(0, progress))

export const evaluateKeyframedScalar = (
	scalar: AnimatedScalar & { keyframes?: ScalarKeyframe[] },
	time: number,
): number => {
	const keyframes = scalar.keyframes?.filter((keyframe) => Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value)) ?? []
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
			return interpolateLinear(from.value, to.value, (time - from.time) / (to.time - from.time))
		}
	}

	return scalar.value
}

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
