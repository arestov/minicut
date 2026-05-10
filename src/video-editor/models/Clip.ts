import { model } from 'dkt/model.js'
import { EFFECT_CREATION_SHAPE } from './Effect'
import { mergeEffectFilters } from '../render/colorPipeline'
import type { EffectRenderInstruction } from '../render/colorPipeline'
import type { PreviewClipSource, ResolvedAnimatedScalar } from '../read-model/previewComps'
import { reduceClipRenderData } from './Clip/comps'
import {
	clipSetAudioAction,
	clipSetFadeAction,
	clipSetTimelineAttrsAction,
	clipSetTransformAction,
	defaultClipTransform,
	normalizeEffectCreationAttrs,
	removeEffectRef,
	reorderEffectRefs,
	reduceClipColorAction,
	reduceClipRenameAction,
	reduceClipSetMediaKindAction,
	reduceClipUpdateOpacityAction,
	reduceSetClipAttrs,
	reduceSetFade,
	reduceSetAudio,
	reduceSetTimelineAttrs,
	reduceSetTransform,
	reduceMoveBy,
	reduceTrim,
	reduceResize,
	reduceSplitAt,
	reduceSetResource,
	reduceSetText,
	reduceSetTrack,
	reduceSetProject,
	reduceSetEffects,
} from './Clip/actions'

const roundToTenths = (value: number): number => Math.round(value * 10) / 10
let splitClipSequence = 0

export const Clip = model({
	model_name: 'minicut_clip',
	attrs: {
		sourceClipId: ['input', null],
		sourceResourceId: ['input', null],
		sourceTextId: ['input', null],
		name: ['input', 'Clip'],
		sourceResourceName: ['input', null],
		color: ['input', '#2563eb'],
		mediaKind: ['input', null],
		start: ['input', 0],
		in: ['input', 0],
		trimStart: ['input', 0],
		duration: ['input', 0],
		fadeIn: ['input', 0],
		fadeOut: ['input', 0],
		audio: ['input', { gain: 1, pan: 0 }],
		opacity: ['input', { value: 1 }],
		transform: ['input', defaultClipTransform],
		splitOriginalDuration: ['input', null],
		crop: ['input', null],
		colorAdjustments: ['input', null],
		renderInterval: ['comp', ['start', 'duration'], (start: unknown, duration: unknown) => {
			const s = typeof start === 'number' && Number.isFinite(start) ? start : 0
			const d = typeof duration === 'number' && Number.isFinite(duration) ? Math.max(0, duration) : 0
			return { start: s, end: s + d, duration: d }
		}],
		renderBox: ['comp', ['transform', 'crop'], (transform: unknown, crop: unknown) => ({
			transform: transform && typeof transform === 'object' ? transform : defaultClipTransform,
			crop: crop && typeof crop === 'object' ? crop : null,
		})],
		effectStackSummary: ['input', null],
		clipRenderData: ['comp', [
			'sourceClipId', 'sourceResourceId', 'sourceResourceName', 'mediaKind', 'name', 'color',
			'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'opacity', 'transform', 'audio',
			'< @all:renderInstruction < effects',
			'< @one:renderAttrs < text',
			'< @one:renderSummary < resource',
		] as const,
		reduceClipRenderData],
	},
	rels: {
		effects: ['input', { many: true, linking: '<< effect << #' }],
		text: ['input', { linking: '<< text << #' }],
		resource: ['input', { linking: '<< resource << #' }],
		track: ['input', { linking: '<< track << #' }],
		project: ['input', { linking: '<< project << #' }],
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
		setClipAttrs: {
			to: {
				sourceClipId: ['sourceClipId'],
				sourceResourceId: ['sourceResourceId'],
				sourceTextId: ['sourceTextId'],
				name: ['name'],
				color: ['color'],
				mediaKind: ['mediaKind'],
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
				fadeIn: ['fadeIn'],
				fadeOut: ['fadeOut'],
				audio: ['audio'],
				opacity: ['opacity'],
				transform: ['transform'],
			},
			fn: reduceSetClipAttrs,
		},
		setMediaKind: {
			to: {
				mediaKind: ['mediaKind'],
			},
			fn: (payload: unknown) => reduceClipSetMediaKindAction(payload) ?? '$noop',
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
			fn: [['fadeIn', 'fadeOut', 'duration'] as const, reduceSetFade],
		},
		setAudio: {
			to: {
				audio: ['audio'],
			},
			fn: [['audio'] as const, reduceSetAudio],
		},
		setTimelineAttrs: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
				fadeIn: ['fadeIn'],
				fadeOut: ['fadeOut'],
			},
			fn: reduceSetTimelineAttrs,
		},
		setTransform: {
			to: {
				transform: ['transform'],
			},
			fn: [['transform'] as const, reduceSetTransform],
		},
		moveBy: {
			to: {
				start: ['start'],
			},
			fn: [['start', 'in', 'duration'] as const, reduceMoveBy],
		},
		trim: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
			},
			fn: [['start', 'in', 'duration'] as const, reduceTrim],
		},
		resize: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
			},
			fn: [['start', 'in', 'duration'] as const, reduceResize],
		},
		splitAt: {
			to: {
				duration: ['duration'],
			},
			fn: [['start', 'in', 'duration'] as const, reduceSplitAt],
		},
		addEffect: {
			to: {
				effect: ['<< effect << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: EFFECT_CREATION_SHAPE,
				}],
				effects: ['<< effects', {
					method: 'at_end',
					can_use_refs: true,
				}],
			},
			fn: [['<<<<'] as const, (payload: unknown, self: unknown) => {
				const attrs = normalizeEffectCreationAttrs(payload)
				return attrs
					? {
						effect: { attrs, rels: { clip: self }, hold_ref_id: 'newEffect' },
						effects: { use_ref_id: 'newEffect' },
					}
					: '$noop'
			}],
		},
		setResource: {
			to: {
				resource: ['<< resource', { method: 'set_one' }],
			},
			fn: reduceSetResource,
		},
		setText: {
			to: {
				text: ['<< text', { method: 'set_one' }],
			},
			fn: reduceSetText,
		},
		setTrack: {
			to: {
				track: ['<< track', { method: 'set_one' }],
			},
			fn: reduceSetTrack,
		},
		setProject: {
			to: {
				project: ['<< project', { method: 'set_one' }],
			},
			fn: reduceSetProject,
		},
		setEffects: {
			to: {
				effects: ['<< effects', { method: 'set_many' }],
			},
			fn: reduceSetEffects,
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
		removeSelf: [
			{
				to: ['<< track', { action: 'removeClipBySourceId', sub_flow: true }],
				fn: [
					['sourceClipId'] as const,
					(_payload: unknown, sourceClipId: unknown) => {
						if (typeof sourceClipId !== 'string') return '$noop'
						return { sourceClipId }
					},
				],
			},
		],
		splitSelfAt: [
			{
				to: {
					duration: ['duration'],
					splitOriginalDuration: ['splitOriginalDuration'],
				},
				fn: [
					['$noop', 'start', 'in', 'duration', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'mediaKind', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'] as const,
					(payload: unknown, noop: unknown, start: unknown, inPoint: unknown, duration: unknown,
						sourceResourceId: unknown, sourceTextId: unknown, name: unknown, color: unknown,
						mediaKind: unknown, fadeIn: unknown, fadeOut: unknown, audio: unknown, opacity: unknown,
						transform: unknown) => {
						const time = (payload as { time?: unknown } | null)?.time
						const s = typeof start === 'number' ? start : 0
						const d = typeof duration === 'number' ? duration : 0
						if (typeof time !== 'number' || time <= s || time >= s + d) return noop
						return {
							duration: roundToTenths(time - s),
							splitOriginalDuration: d,
						}
					},
				],
			},
			{
				to: ['<< track', { action: 'splitClipAt', sub_flow: true }],
				fn: [
					['$noop', 'start', 'in', 'duration', 'splitOriginalDuration', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'mediaKind', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'] as const,
					(_payload: unknown, noop: unknown, start: unknown, inPoint: unknown, duration: unknown, splitOriginalDuration: unknown,
						sourceResourceId: unknown, sourceTextId: unknown, name: unknown, color: unknown,
						mediaKind: unknown, fadeIn: unknown, fadeOut: unknown, audio: unknown, opacity: unknown,
						transform: unknown) => {
						const s = typeof start === 'number' ? start : 0
						const ip = typeof inPoint === 'number' ? inPoint : 0
						const leftDuration = typeof duration === 'number' ? duration : 0
						const originalDuration = typeof splitOriginalDuration === 'number' ? splitOriginalDuration : 0
						if (!Number.isFinite(originalDuration) || originalDuration <= leftDuration || leftDuration <= 0) {
							return noop
						}
						const splitTime = roundToTenths(s + leftDuration)
						const rightDuration = roundToTenths(originalDuration - leftDuration)
						const seq = ++splitClipSequence
						return {
							sourceClipId: `clip:split-right:${seq}`,
							sourceResourceId: typeof sourceResourceId === 'string' ? sourceResourceId : null,
							sourceTextId: typeof sourceTextId === 'string' ? sourceTextId : null,
							name: typeof name === 'string' ? name : 'Clip',
							color: typeof color === 'string' ? color : '#2563eb',
							mediaKind: typeof mediaKind === 'string' ? mediaKind : 'video',
							start: splitTime,
							in: roundToTenths(ip + leftDuration),
							duration: rightDuration,
							fadeIn: 0,
							fadeOut: typeof fadeOut === 'number' ? fadeOut : 0,
							audio: audio && typeof audio === 'object' ? audio : { gain: 1, pan: 0 },
							opacity: opacity && typeof opacity === 'object' ? opacity : { value: 1 },
							transform: transform && typeof transform === 'object' ? transform : defaultClipTransform,
							splitTime,
							sourceClip: { start: s, in: ip, duration: originalDuration },
						}
					},
				],
			},
			{
				to: {
					splitOriginalDuration: ['splitOriginalDuration'],
				},
				fn: () => ({ splitOriginalDuration: null }),
			},
		],
	},
})

export const CLIP_CREATION_SHAPE = {
	attrs: ['sourceClipId', 'sourceResourceId', 'sourceResourceName', 'sourceTextId', 'name', 'color', 'mediaKind', 'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'],
	rels: {
		track: {},
		text: {},
		effects: {},
	},
} as const
