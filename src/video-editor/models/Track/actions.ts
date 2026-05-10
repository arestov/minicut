import { defaultClipTransform } from '../Clip/actions'
import { defaultTextBox, defaultTextStyle } from '../Text/defaults'
import type { MiniCutDktClipSeed, MiniCutDktTextSeed } from '../../dkt/runtime/seedTypes'

export type TrackAddClipPayload = MiniCutDktClipSeed & {
	resource?: unknown
	resourceId?: string | null
}

export type TrackAddTextClipPayload = MiniCutDktClipSeed & {
	text?: MiniCutDktTextSeed
}

const asString = (value: unknown): string | null => typeof value === 'string' ? value : null
const asNumber = (value: unknown): number | null => typeof value === 'number' ? value : null
const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === 'object' ? value as Value : null

export const normalizeClipCreationAttrs = (payload: unknown) => {
	const value = payload as TrackAddClipPayload | null
	return {
		name: asString(value?.name) ?? 'Clip',
		color: asString(value?.color) ?? '#2563eb',
		mediaKind: asString(value?.mediaKind),
		start: asNumber(value?.start) ?? 0,
		in: asNumber(value?.in) ?? 0,
		duration: asNumber(value?.duration) ?? 0,
		fadeIn: asNumber(value?.fadeIn) ?? 0,
		fadeOut: asNumber(value?.fadeOut) ?? 0,
		audio: asObject(value?.audio) ?? { gain: 1, pan: 0 },
		opacity: asObject(value?.opacity) ?? { value: 1 },
		transform: asObject(value?.transform) ?? defaultClipTransform,
	}
}

export const normalizeTextCreationAttrs = (payload: unknown) => {
	const value = payload as MiniCutDktTextSeed | null
	return {
		content: asString(value?.content) ?? 'Text',
		style: asObject(value?.style) ?? defaultTextStyle,
		box: asObject(value?.box) ?? defaultTextBox,
	}
}

const getNodeId = (model: unknown): string | null => (
	model && typeof model === 'object' && typeof (model as { _node_id?: unknown })._node_id === 'string'
		? (model as { _node_id: string })._node_id
		: null
)

export const removeClipRef = (clips: unknown[], clipId: unknown): unknown[] | null => {
	if (typeof clipId !== 'string') return null
	const idx = clips.findIndex((clip) => getNodeId(clip) === clipId)
	if (idx < 0) return null
	return clips.filter((_, i) => i !== idx)
}

export const normalizeRightSplitClipAttrs = (payload: unknown) => {
	const value = payload as TrackAddClipPayload & { splitTime?: unknown; sourceClip?: { start?: unknown; in?: unknown; duration?: unknown } } | null
	const source = value?.sourceClip
	const splitTime = typeof value?.splitTime === 'number'
		? value.splitTime
		: typeof (payload as { time?: unknown } | null)?.time === 'number'
			? (payload as { time: number }).time
			: null
	const sourceStart = asNumber(source?.start) ?? asNumber(value?.start)
	const sourceIn = asNumber(source?.in) ?? asNumber(value?.in) ?? 0
	const sourceDuration = asNumber(source?.duration) ?? asNumber(value?.duration)
	if (splitTime === null || sourceStart === null || sourceDuration === null) {
		return null
	}
	const sourceEnd = sourceStart + sourceDuration
	if (splitTime <= sourceStart || splitTime >= sourceEnd) {
		return null
	}
	return normalizeClipCreationAttrs({
		...value,
		start: splitTime,
		in: sourceIn + (splitTime - sourceStart),
		duration: sourceEnd - splitTime,
	})
}

export const reduceRenameTrack = (payload: unknown) => {
	const name = typeof payload === 'string'
		? payload
		: (payload as { name?: unknown } | null)?.name
	return typeof name === 'string' && name ? { name } : '$noop'
}

export const reduceSetTrackMuted = (payload: unknown) => {
	const muted = typeof payload === 'boolean'
		? payload
		: (payload as { muted?: unknown } | null)?.muted
	return typeof muted === 'boolean' ? { muted } : '$noop'
}

export const reduceSetTrackLocked = (payload: unknown) => {
	const locked = typeof payload === 'boolean'
		? payload
		: (payload as { locked?: unknown } | null)?.locked
	return typeof locked === 'boolean' ? { locked } : '$noop'
}

const resolveResourceRef = (payload: unknown): unknown => {
	const value = payload as { resource?: unknown } | null
	return value?.resource ?? null
}

export const reduceAddClip = (payload: unknown, self: unknown) => {
	const attrs = normalizeClipCreationAttrs(payload)
	const resource = resolveResourceRef(payload)
	return {
		clip: {
			attrs,
			rels: resource
				? { track: self, resource }
				: { track: self },
			hold_ref_id: 'newClip',
		},
		clips: { use_ref_id: 'newClip' },
	}
}

export const reduceAddTextClip = (payload: unknown, self: unknown) => {
	const value = payload as { text?: unknown } | null
	const clipAttrs = normalizeClipCreationAttrs(payload)
	const textAttrs = normalizeTextCreationAttrs(value?.text)
	return {
		clip: {
			attrs: { ...clipAttrs, mediaKind: 'text' },
			rels: { track: self, text: { use_ref_id: 'newTextNode' } },
			hold_ref_id: 'newTextClip',
		},
		text: {
			attrs: textAttrs,
			rels: { clip: { use_ref_id: 'newTextClip' } },
			hold_ref_id: 'newTextNode',
		},
		clips: { use_ref_id: 'newTextClip' },
	}
}

export const reduceSplitClipAt = (payload: unknown, self: unknown) => {
	const attrs = normalizeRightSplitClipAttrs(payload)
	if (!attrs) {
		return '$noop'
	}
	const resource = (payload as { resource?: unknown } | null)?.resource ?? null
	const text = (payload as { text?: unknown } | null)?.text ?? null
	return {
		clip: {
			attrs,
			rels: {
				track: self,
				...(resource ? { resource } : {}),
				...(text ? { text } : {}),
			},
			hold_ref_id: 'rightSplitClip',
		},
		clips: { use_ref_id: 'rightSplitClip' },
	}
}

export const reduceSetClips = (payload: unknown) => {
	const clips = (payload as { clips?: unknown } | null)?.clips
	return { clips: Array.isArray(clips) ? clips : [] }
}

export const reduceRemoveClip = (payload: unknown, clips: unknown[]) => {
	const clipId = (payload as { clipId?: unknown } | null)?.clipId ?? payload
	const nextClips = removeClipRef(Array.isArray(clips) ? clips : [], clipId)
	return { clips: nextClips ?? (Array.isArray(clips) ? clips : []) }
}
