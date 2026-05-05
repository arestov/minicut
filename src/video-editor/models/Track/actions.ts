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
