import { defaultClipTransform } from '../Clip/actions'
import { defaultTextBox, defaultTextStyle } from '../Text/defaults'
import type { MiniCutDktClipSeed, MiniCutDktTextSeed } from '../../dkt/runtime/createMiniCutDktRuntime'

export type TrackAddClipPayload = MiniCutDktClipSeed & {
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
	const sourceClipId = asString(value?.sourceClipId)
	if (!sourceClipId) {
		return null
	}

	return {
		sourceClipId,
		sourceResourceId: asString(value?.sourceResourceId),
		sourceTextId: asString(value?.sourceTextId),
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
	const sourceTextId = asString(value?.sourceTextId)
	if (!sourceTextId) {
		return null
	}

	return {
		sourceTextId,
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

const getSourceClipId = (model: unknown): string | null => {
	if (!model || typeof model !== 'object') return null
	const md = model as Record<string, unknown>
	if (typeof md.sourceClipId === 'string') return md.sourceClipId
	return null
}

const getAttr = (model: unknown, key: string): unknown => {
	const md = model && typeof model === 'object' ? model as Record<string, unknown> : null
	return md?.[key]
}

export const removeClipRef = (clips: unknown[], clipId: unknown): unknown[] | null => {
	if (typeof clipId !== 'string') return null
	const idx = clips.findIndex((clip) => getNodeId(clip) === clipId)
	if (idx < 0) return null
	return clips.filter((_, i) => i !== idx)
}

export const removeClipBySourceClipId = (clips: unknown[], sourceClipId: unknown): unknown[] | null => {
	if (typeof sourceClipId !== 'string') return null
	const idx = clips.findIndex((clip) => getSourceClipId(clip) === sourceClipId)
	if (idx < 0) return null
	return clips.filter((_, i) => i !== idx)
}

export const findClipAttrsBySourceClipId = (
	clips: unknown[],
	sourceClipId: unknown,
	keys: readonly string[],
): Record<string, unknown> | null => {
	if (typeof sourceClipId !== 'string') return null
	const clip = clips.find((c) => getSourceClipId(c) === sourceClipId)
	if (!clip) return null
	const result: Record<string, unknown> = {}
	for (const key of keys) {
		result[key] = getAttr(clip, key)
	}
	return result
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
	const attrs = normalizeClipCreationAttrs({
		...value,
		start: splitTime,
		in: sourceIn + (splitTime - sourceStart),
		duration: sourceEnd - splitTime,
	})
	return attrs
}
