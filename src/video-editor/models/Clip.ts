import { model } from 'dkt/model.js'
import { EFFECT_PROXY_CREATION_SHAPE } from './Effect'
import {
	clipSetAudioAction,
	clipSetFadeAction,
	clipSetTransformAction,
	defaultClipTransform,
	normalizeEffectCreationAttrs,
	removeEffectRef,
	reorderEffectRefs,
	reduceClipColorAction,
	reduceClipRenameAction,
	reduceClipUpdateOpacityAction,
} from './Clip/actions'
import {
	reduceTimelineMoveByAction,
	reduceTimelineResizeAction,
	reduceTimelineSplitAtAction,
	reduceTimelineTrimAction,
} from './Clip/actions'

export const Clip = model({
	model_name: 'minicut_clip',
	attrs: {
		sourceClipId: ['input', null],
		sourceResourceId: ['input', null],
		sourceTextId: ['input', null],
		name: ['input', 'Clip'],
		color: ['input', '#2563eb'],
		start: ['input', 0],
		in: ['input', 0],
		duration: ['input', 0],
		fadeIn: ['input', 0],
		fadeOut: ['input', 0],
		audio: ['input', { gain: 1, pan: 0 }],
		opacity: ['input', { value: 1 }],
		transform: ['input', defaultClipTransform],
	},
	rels: {
		effects: ['input', { many: true, linking: '<< effect << #' }],
		text: ['input', { linking: '<< text << #' }],
		resource: ['input', { linking: '<< resource << #' }],
	},
	actions: {
		updateOpacity: {
			to: {
				opacity: ['opacity'],
			},
			fn: (payload: unknown) => reduceClipUpdateOpacityAction(payload) ?? '$noop',
		},
		rename: {
			to: {
				name: ['name'],
			},
			fn: (payload: unknown) => reduceClipRenameAction(payload) ?? '$noop',
		},
		color: {
			to: {
				color: ['color'],
			},
			fn: (payload: unknown) => reduceClipColorAction(payload) ?? '$noop',
		},
		setFade: {
			to: {
				fadeIn: ['fadeIn'],
				fadeOut: ['fadeOut'],
			},
			fn: [
				['fadeIn', 'fadeOut', 'duration'] as const,
				(payload: unknown, fadeIn: unknown, fadeOut: unknown, duration: unknown) => {
					const patch = clipSetFadeAction.fn(payload, {
						fadeIn: typeof fadeIn === 'number' ? fadeIn : 0,
						fadeOut: typeof fadeOut === 'number' ? fadeOut : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		setAudio: {
			to: {
				audio: ['audio'],
			},
			fn: [
				['audio'] as const,
				(payload: unknown, audio: unknown) => {
					const patch = clipSetAudioAction.fn(payload, audio as { gain: number; pan: number })
					return patch ?? '$noop'
				},
			],
		},
		setTransform: {
			to: {
				transform: ['transform'],
			},
			fn: [
				['transform'] as const,
				(payload: unknown, transform: unknown) => {
					const patch = clipSetTransformAction.fn(payload, transform as typeof defaultClipTransform)
					return patch ?? '$noop'
				},
			],
		},
		moveBy: {
			to: {
				start: ['start'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceTimelineMoveByAction(payload, {
						start: typeof start === 'number' ? start : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		trim: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceTimelineTrimAction(payload, {
						start: typeof start === 'number' ? start : 0,
						in: typeof inPoint === 'number' ? inPoint : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		resize: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceTimelineResizeAction(payload, {
						start: typeof start === 'number' ? start : 0,
						in: typeof inPoint === 'number' ? inPoint : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		splitAt: {
			to: {
				duration: ['duration'],
			},
			fn: [
				['start', 'in', 'duration'] as const,
				(payload: unknown, start: unknown, inPoint: unknown, duration: unknown) => {
					const patch = reduceTimelineSplitAtAction(payload, {
						start: typeof start === 'number' ? start : 0,
						duration: typeof duration === 'number' ? duration : 0,
					})
					return patch ?? '$noop'
				},
			],
		},
		addEffect: {
			to: ['<< effect << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: EFFECT_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const attrs = normalizeEffectCreationAttrs(payload)
				return attrs ? { attrs } : '$noop'
			},
		},
		removeEffect: {
			to: {
				effects: ['<< effects', { method: 'set_many' }],
			},
			fn: [
				['<< @all:effects'] as const,
				(payload: unknown, effects: unknown[]) => {
					const effectId = (payload as { effectId?: unknown } | null)?.effectId ?? payload
					const nextEffects = removeEffectRef(Array.isArray(effects) ? effects : [], effectId)
					return nextEffects ? { effects: nextEffects } : '$noop'
				},
			],
		},
		reorderEffect: {
			to: {
				effects: ['<< effects', { method: 'set_many' }],
			},
			fn: [
				['<< @all:effects'] as const,
				(payload: unknown, effects: unknown[]) => {
					const value = payload as { effectId?: unknown; toIndex?: unknown } | null
					const nextEffects = reorderEffectRefs(Array.isArray(effects) ? effects : [], value?.effectId, value?.toIndex)
					return nextEffects ? { effects: nextEffects } : '$noop'
				},
			],
		},
	},
})

export const CLIP_PROXY_CREATION_SHAPE = {
	attrs: ['sourceClipId', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'],
} as const
