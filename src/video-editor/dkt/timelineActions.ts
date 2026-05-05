import type { ClipAttrs } from '../domain/types'

export type DktTimelineClipActionName = 'moveBy' | 'trim' | 'resize' | 'splitAt'
export type DktTimelineClipActionPatch = Partial<Pick<ClipAttrs, 'start' | 'in' | 'duration'>>

const roundToTenths = (value: number): number => Math.round(value * 10) / 10
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const getDktResizedClipAttrs = (
	attrs: Pick<ClipAttrs, 'start' | 'in' | 'duration'>,
	edge: 'start' | 'end',
	delta: number,
): DktTimelineClipActionPatch | null => {
	if (!Number.isFinite(delta) || delta === 0) {
		return null
	}

	if (edge === 'end') {
		return {
			duration: clamp(roundToTenths(attrs.duration + delta), 0.5, 120),
		}
	}

	const clipEnd = attrs.start + attrs.duration
	const minStart = Math.max(0, attrs.start - attrs.in)
	const nextStart = clamp(roundToTenths(attrs.start + delta), minStart, clipEnd - 0.5)
	return {
		start: nextStart,
		in: roundToTenths(attrs.in + (nextStart - attrs.start)),
		duration: roundToTenths(clipEnd - nextStart),
	}
}

export const reduceTimelineMoveByAction = (
	payload: unknown,
	attrs: Pick<ClipAttrs, 'start'>,
): DktTimelineClipActionPatch | null => {
	const delta = (payload as { delta?: unknown } | null)?.delta
	return typeof delta === 'number' && Number.isFinite(delta) && delta !== 0
		? { start: Math.max(0, roundToTenths(attrs.start + delta)) }
		: null
}

export const reduceTimelineTrimAction = (
	payload: unknown,
	attrs: Pick<ClipAttrs, 'start' | 'in' | 'duration'>,
): DktTimelineClipActionPatch | null => {
	const edge = (payload as { edge?: unknown } | null)?.edge
	const delta = (payload as { delta?: unknown } | null)?.delta
	return (edge === 'start' || edge === 'end') && typeof delta === 'number'
		? getDktResizedClipAttrs(attrs, edge, delta)
		: null
}

export const reduceTimelineResizeAction = reduceTimelineTrimAction

export const reduceTimelineSplitAtAction = (
	payload: unknown,
	attrs: Pick<ClipAttrs, 'start' | 'duration'>,
): DktTimelineClipActionPatch | null => {
	const time = (payload as { time?: unknown } | null)?.time
	if (typeof time !== 'number' || time <= attrs.start || time >= attrs.start + attrs.duration) {
		return null
	}

	return { duration: roundToTenths(time - attrs.start) }
}
