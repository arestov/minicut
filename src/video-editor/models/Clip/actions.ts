import type { AnimatedScalar } from '../../render/registryTypes'
import type { ClipAttrs, TransformAttrs } from './types'
import { defaultEffectAttrs } from '../Effect/defaults'
import type { MiniCutDktEffectSeed } from '../../dkt/runtime/createMiniCutDktRuntime'

const roundToTenths = (value: number): number => Math.round(value * 10) / 10
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const asString = (value: unknown): string | null => typeof value === 'string' ? value : null
const asNumber = (value: unknown): number | null => typeof value === 'number' ? value : null
const asBoolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null
const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === 'object' ? value as Value : null

export type DktClipActionName = 'updateOpacity' | 'rename' | 'color' | 'setFade' | 'setAudio' | 'setTimelineAttrs' | 'setTransform' | 'setMediaKind' | 'setClipAttrs' | 'addEffect' | 'removeEffect' | 'reorderEffect'
export type DktTimelineClipActionName = 'moveBy' | 'trim' | 'resize' | 'splitAt'

export type DktClipActionPatch = Partial<Pick<ClipAttrs,
	| 'name'
	| 'color'
	| 'start'
	| 'in'
	| 'duration'
	| 'opacity'
	| 'fadeIn'
	| 'fadeOut'
	| 'audio'
	| 'transform'
>>
export type DktTimelineClipActionPatch = Partial<Pick<ClipAttrs, 'start' | 'in' | 'duration'>>

export const clipUpdateOpacityAction = {
	to: ['opacity'] as const,
	fn(opacityPercent: number): { value: number } | null {
		if (!Number.isFinite(opacityPercent)) {
			return null
		}

		return { value: roundToTenths(opacityPercent / 100) }
	},
}

export const reduceClipUpdateOpacityAction = (payload: unknown): Pick<ClipAttrs, 'opacity'> | null => {
	const opacityPercent = typeof payload === 'number'
		? payload
		: (payload as { opacityPercent?: unknown } | null)?.opacityPercent
	const opacity = typeof opacityPercent === 'number' ? clipUpdateOpacityAction.fn(opacityPercent) : null
	return opacity ? { opacity } : null
}

export const clipRenameAction = {
	to: ['name'] as const,
	fn(payload: unknown): string | null {
		const value = (payload as { name?: unknown } | null)?.name ?? payload
		return typeof value === 'string' ? value : null
	},
}

export const reduceClipRenameAction = (payload: unknown): Pick<ClipAttrs, 'name'> | null => {
	const name = clipRenameAction.fn(payload)
	return name === null ? null : { name }
}

export const clipColorAction = {
	to: ['color'] as const,
	fn(payload: unknown): string | null {
		const value = (payload as { color?: unknown } | null)?.color ?? payload
		return typeof value === 'string' ? value : null
	},
}

export const reduceClipColorAction = (payload: unknown): Pick<ClipAttrs, 'color'> | null => {
	const color = clipColorAction.fn(payload)
	return color === null ? null : { color }
}

export const reduceClipSetMediaKindAction = (payload: unknown): Pick<ClipAttrs, 'mediaKind'> | null => {
	const mediaKind = typeof payload === 'string'
		? payload
		: (payload as { mediaKind?: unknown } | null)?.mediaKind
	return mediaKind === 'video' || mediaKind === 'audio' || mediaKind === 'image' || mediaKind === 'text'
		? { mediaKind }
		: null
}

export const clipSetFadeAction = {
	fn(payload: unknown, clipAttrs: Pick<ClipAttrs, 'fadeIn' | 'fadeOut' | 'duration'>): Pick<ClipAttrs, 'fadeIn'> | Pick<ClipAttrs, 'fadeOut'> | null {
		const edge = (payload as { edge?: unknown } | null)?.edge
		const delta = (payload as { delta?: unknown } | null)?.delta
		if ((edge !== 'in' && edge !== 'out') || typeof delta !== 'number') {
			return null
		}

		const key = edge === 'in' ? 'fadeIn' : 'fadeOut'
		const current = Number(clipAttrs[key] ?? 0)
		return { [key]: clamp(roundToTenths(current + delta), 0, clipAttrs.duration) }
	},
}

export const clipSetAudioAction = {
	fn(payload: unknown, audio: ClipAttrs['audio']): Pick<ClipAttrs, 'audio'> {
		const partial = payload as Partial<Record<'gain' | 'pan', number>>
		return {
			audio: {
				gain: partial.gain ?? audio?.gain ?? 1,
				pan: partial.pan ?? audio?.pan ?? 0,
			},
		}
	},
}

export const clipSetTimelineAttrsAction = {
	fn(payload: unknown): Pick<ClipAttrs, 'start' | 'in' | 'duration' | 'fadeIn' | 'fadeOut'> | null {
		const value = payload as Partial<Pick<ClipAttrs, 'start' | 'in' | 'duration' | 'fadeIn' | 'fadeOut'>> | null
		const start = Number(value?.start)
		const inPoint = Number(value?.in)
		const duration = Number(value?.duration)
		if (!Number.isFinite(start) || !Number.isFinite(inPoint) || !Number.isFinite(duration)) {
			return null
		}

		return {
			start,
			in: inPoint,
			duration,
			fadeIn: Number(value?.fadeIn ?? 0),
			fadeOut: Number(value?.fadeOut ?? 0),
		}
	},
}

export const clipSetTransformAction = {
	fn(payload: unknown, transform: TransformAttrs): Pick<ClipAttrs, 'transform'> {
		const partial = payload as Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>
		return {
			transform: {
				x: { value: partial.x ?? transform.x.value },
				y: { value: partial.y ?? transform.y.value },
				scale: { value: partial.scale ?? transform.scale.value },
				rotation: { value: partial.rotation ?? transform.rotation.value },
			},
		}
	},
}

export const defaultClipTransform: TransformAttrs = {
	x: { value: 0 },
	y: { value: 0 },
	scale: { value: 1 },
	rotation: { value: 0 },
}

export const toAnimatedScalar = (value: unknown, fallback: AnimatedScalar): AnimatedScalar => {
	if (value && typeof value === 'object' && 'value' in value && typeof (value as { value?: unknown }).value === 'number') {
		return value as AnimatedScalar
	}

	return fallback
}

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

export const normalizeEffectCreationAttrs = (payload: unknown) => {
	const value = payload as MiniCutDktEffectSeed | null
	const sourceEffectId = asString(value?.sourceEffectId)
		?? asString((payload as { effectId?: unknown } | null)?.effectId)
		?? createDktEffectSourceId(value?.kind)

	const kindStr = asString(value?.kind)
	const kindDerivedName = kindStr ? kindStr.charAt(0).toUpperCase() + kindStr.slice(1) : null

	return {
		sourceEffectId,
		name: asString(value?.name) ?? kindDerivedName ?? defaultEffectAttrs.name,
		kind: asString(value?.kind) ?? defaultEffectAttrs.kind,
		enabled: asBoolean(value?.enabled) ?? defaultEffectAttrs.enabled,
		amount: asNumber(value?.amount),
		params: asObject(value?.params),
		color: asObject(value?.color),
	}
}

let effectCreationSequence = 0

const createDktEffectSourceId = (kind: unknown): string => {
	effectCreationSequence += 1
	const safeKind = typeof kind === 'string' && kind ? kind.replace(/[^a-z0-9_-]/gi, '-') : 'effect'
	return `dkt-effect:${safeKind}:${Date.now().toString(36)}:${effectCreationSequence}`
}

const getNodeId = (model: unknown): string | null => (
	model && typeof model === 'object' && typeof (model as { _node_id?: unknown })._node_id === 'string'
		? (model as { _node_id: string })._node_id
		: null
)

export const reorderEffectRefs = (effects: unknown[], effectId: unknown, toIndex: unknown): unknown[] | null => {
	if (typeof effectId !== 'string' || typeof toIndex !== 'number') {
		return null
	}
	const currentIndex = effects.findIndex((effect) => getNodeId(effect) === effectId)
	if (currentIndex < 0) {
		return null
	}
	const withoutEffect = effects.filter((effect) => getNodeId(effect) !== effectId)
	const nextIndex = Math.max(0, Math.min(toIndex, withoutEffect.length))
	return [...withoutEffect.slice(0, nextIndex), effects[currentIndex], ...withoutEffect.slice(nextIndex)]
}

export const removeEffectRef = (effects: unknown[], effectId: unknown): unknown[] | null => {
	if (typeof effectId !== 'string' || !effects.some((effect) => getNodeId(effect) === effectId)) {
		return null
	}
	return effects.filter((effect) => getNodeId(effect) !== effectId)
}
