import { defaultClipTransform } from '../Clip/actions'
import { defaultTextBox, defaultTextStyle } from '../Text/defaults'
import type { MiniCutDktClipProxyInput, MiniCutDktTextProxyInput } from '../../dkt/runtime/createMiniCutDktRuntime'

export type TrackAddClipPayload = MiniCutDktClipProxyInput & {
	resourceId?: string | null
}

export type TrackAddTextClipPayload = MiniCutDktClipProxyInput & {
	text?: MiniCutDktTextProxyInput
}

export const normalizeClipCreationAttrs = (payload: unknown) => {
	const value = payload as TrackAddClipPayload | null
	if (typeof value?.sourceClipId !== 'string' || !value.sourceClipId) {
		return null
	}

	return {
		sourceClipId: value.sourceClipId,
		name: typeof value.name === 'string' ? value.name : 'Clip',
		color: typeof value.color === 'string' ? value.color : '#2563eb',
		start: typeof value.start === 'number' ? value.start : 0,
		in: typeof value.in === 'number' ? value.in : 0,
		duration: typeof value.duration === 'number' ? value.duration : 0,
		fadeIn: typeof value.fadeIn === 'number' ? value.fadeIn : 0,
		fadeOut: typeof value.fadeOut === 'number' ? value.fadeOut : 0,
		audio: value.audio && typeof value.audio === 'object' ? value.audio : { gain: 1, pan: 0 },
		opacity: value.opacity && typeof value.opacity === 'object' ? value.opacity : { value: 1 },
		transform: value.transform && typeof value.transform === 'object' ? value.transform : defaultClipTransform,
	}
}

export const normalizeTextCreationAttrs = (payload: unknown) => {
	const value = payload as MiniCutDktTextProxyInput | null
	if (typeof value?.sourceTextId !== 'string' || !value.sourceTextId) {
		return null
	}

	return {
		sourceTextId: value.sourceTextId,
		content: typeof value.content === 'string' ? value.content : 'Text',
		style: value.style && typeof value.style === 'object' ? value.style : defaultTextStyle,
		box: value.box && typeof value.box === 'object' ? value.box : defaultTextBox,
	}
}

const getNodeId = (model: unknown): string | null => (
	model && typeof model === 'object' && typeof (model as { _node_id?: unknown })._node_id === 'string'
		? (model as { _node_id: string })._node_id
		: null
)

export const removeClipRef = (clips: unknown[], clipId: unknown): unknown[] | null => {
	if (typeof clipId !== 'string' || !clips.some((clip) => getNodeId(clip) === clipId)) {
		return null
	}
	return clips.filter((clip) => getNodeId(clip) !== clipId)
}

export const normalizeRightSplitClipAttrs = (payload: unknown) => {
	const value = payload as TrackAddClipPayload & { splitTime?: unknown; sourceClip?: { start?: unknown; in?: unknown; duration?: unknown } } | null
	const source = value?.sourceClip
	const splitTime = typeof value?.splitTime === 'number'
		? value.splitTime
		: typeof (payload as { time?: unknown } | null)?.time === 'number'
			? (payload as { time: number }).time
			: null
	const sourceStart = typeof source?.start === 'number' ? source.start : typeof value?.start === 'number' ? value.start : null
	const sourceIn = typeof source?.in === 'number' ? source.in : typeof value?.in === 'number' ? value.in : 0
	const sourceDuration = typeof source?.duration === 'number' ? source.duration : typeof value?.duration === 'number' ? value.duration : null
	if (splitTime === null || sourceStart === null || sourceDuration === null) {
		return null
	}
	const sourceEnd = sourceStart + sourceDuration
	if (splitTime <= sourceStart || splitTime >= sourceEnd) {
		return null
	}
	const attrs = normalizeClipCreationAttrs({
		...value,
		start: splitTime,
		in: sourceIn + (splitTime - sourceStart),
		duration: sourceEnd - splitTime,
	})
	return attrs
}
