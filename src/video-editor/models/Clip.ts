import { model } from 'dkt/model.js'
import { EFFECT_CREATION_SHAPE } from './Effect'
import { mergeEffectFilters } from '../render/colorPipeline'
import type { EffectRenderInstruction } from '../render/colorPipeline'
import type { PreviewClipSource, ResolvedAnimatedScalar } from '../read-model/previewComps'
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
} from './Clip/actions'
import {
	reduceTimelineMoveByAction,
	reduceTimelineResizeAction,
	reduceTimelineSplitAtAction,
	reduceTimelineTrimAction,
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
			'sourceClipId', 'sourceResourceId', 'mediaKind', 'name', 'color',
			'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'opacity', 'transform', 'audio',
			'< @all:renderInstruction < effects',
			'< @one:renderAttrs < text',
			'< @one:renderSummary < resource',
		] as const,
		(
			sourceClipId: unknown, sourceResourceId: unknown, mediaKind: unknown, name: unknown, color: unknown,
			start: unknown, inPoint: unknown, duration: unknown, fadeIn: unknown, fadeOut: unknown,
			opacity: unknown, transform: unknown, audio: unknown,
			effectInstructions: unknown,
			textAttrs: unknown,
			resourceSummary: unknown,
		): PreviewClipSource => {
			const effects: EffectRenderInstruction[] = Array.isArray(effectInstructions)
				? (effectInstructions.flat().filter(Boolean) as EffectRenderInstruction[])
				: []
			const filters = mergeEffectFilters(effects)
			const res = resourceSummary && typeof resourceSummary === 'object'
				? resourceSummary as { name: string; kind: string; url: string; mime: string }
				: null
			const asNum = (v: unknown, fb: number): number => typeof v === 'number' && Number.isFinite(v) ? v : fb
			const asStr = (v: unknown, fb: string): string => typeof v === 'string' ? v : fb
			const asAnimScalar = (v: unknown, fb: number): ResolvedAnimatedScalar => {
				if (v && typeof v === 'object' && 'value' in v) return v as ResolvedAnimatedScalar
				return { value: typeof v === 'number' ? v : fb }
			}
			const asTransform = (v: unknown) => {
				const t = v && typeof v === 'object' ? v as Record<string, unknown> : defaultClipTransform
				return {
					x: asAnimScalar(t.x, 0),
					y: asAnimScalar(t.y, 0),
					scale: asAnimScalar(t.scale, 1),
					rotation: asAnimScalar(t.rotation, 0),
				}
			}
			return {
				id: asStr(sourceClipId, ''),
				resourceId: typeof sourceResourceId === 'string' ? sourceResourceId : null,
				name: asStr(name, 'Clip'),
				color: asStr(color, '#2563eb'),
				resourceName: res?.name ?? asStr(name, 'Clip'),
				resourceKind: asStr(res?.kind ?? mediaKind, 'video') as PreviewClipSource['resourceKind'],
				resourceUrl: res?.url ?? '',
				mime: res?.mime ?? 'application/octet-stream',
				inPoint: asNum(inPoint, 0),
				start: asNum(start, 0),
				duration: asNum(duration, 0),
				fadeIn: asNum(fadeIn, 0),
				fadeOut: asNum(fadeOut, 0),
				opacity: asAnimScalar(opacity, 1),
				transform: asTransform(transform),
				audio: audio && typeof audio === 'object' ? audio as { gain: number; pan: number } : { gain: 1, pan: 0 },
				filters: filters ? [filters] : [],
				effects,
				text: textAttrs && typeof textAttrs === 'object' ? textAttrs as PreviewClipSource['text'] : null,
			}
		}],
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
			fn: (payload: unknown) => {
				const value = payload as Record<string, unknown> | null
				if (!value || typeof value !== 'object') {
					return '$noop'
				}

				return {
					sourceClipId: typeof value.sourceClipId === 'string' ? value.sourceClipId : null,
					sourceResourceId: typeof value.sourceResourceId === 'string' ? value.sourceResourceId : null,
					sourceTextId: typeof value.sourceTextId === 'string' ? value.sourceTextId : null,
					name: typeof value.name === 'string' ? value.name : 'Clip',
					color: typeof value.color === 'string' ? value.color : '#2563eb',
					mediaKind: typeof value.mediaKind === 'string' ? value.mediaKind : null,
					start: typeof value.start === 'number' ? value.start : 0,
					in: typeof value.in === 'number' ? value.in : 0,
					duration: typeof value.duration === 'number' ? value.duration : 0,
					fadeIn: typeof value.fadeIn === 'number' ? value.fadeIn : 0,
					fadeOut: typeof value.fadeOut === 'number' ? value.fadeOut : 0,
					audio: value.audio && typeof value.audio === 'object' ? value.audio : { gain: 1, pan: 0 },
					opacity: value.opacity && typeof value.opacity === 'object' ? value.opacity : { value: 1 },
					transform: value.transform && typeof value.transform === 'object' ? value.transform : defaultClipTransform,
				}
			},
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
		setTimelineAttrs: {
			to: {
				start: ['start'],
				in: ['in'],
				duration: ['duration'],
				fadeIn: ['fadeIn'],
				fadeOut: ['fadeOut'],
			},
			fn: (payload: unknown) => clipSetTimelineAttrsAction.fn(payload) ?? '$noop',
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
			fn: (payload: unknown) => {
				const attrs = normalizeEffectCreationAttrs(payload)
				return attrs
					? {
						effect: { attrs, hold_ref_id: 'newEffect' },
						effects: { use_ref_id: 'newEffect' },
					}
					: '$noop'
			},
		},
		setResource: {
			to: {
				resource: ['<< resource', { method: 'set_one' }],
			},
			fn: (payload: unknown) => ({
				resource: (payload as { resource?: unknown } | null)?.resource ?? null,
			}),
		},
		setText: {
			to: {
				text: ['<< text', { method: 'set_one' }],
			},
			fn: (payload: unknown) => ({
				text: (payload as { text?: unknown } | null)?.text ?? null,
			}),
		},
		setEffects: {
			to: {
				effects: ['<< effects', { method: 'set_many' }],
			},
			fn: (payload: unknown) => {
				const effects = (payload as { effects?: unknown } | null)?.effects
				return { effects: Array.isArray(effects) ? effects : [] }
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
				},
				fn: [
					['start', 'in', 'duration', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'mediaKind', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'] as const,
					(payload: unknown, start: unknown, inPoint: unknown, duration: unknown,
						sourceResourceId: unknown, sourceTextId: unknown, name: unknown, color: unknown,
						mediaKind: unknown, fadeIn: unknown, fadeOut: unknown, audio: unknown, opacity: unknown,
						transform: unknown) => {
						const time = (payload as { time?: unknown } | null)?.time
						const s = typeof start === 'number' ? start : 0
						const d = typeof duration === 'number' ? duration : 0
						if (typeof time !== 'number' || time <= s || time >= s + d) return '$noop'
						return { duration: roundToTenths(time - s) }
					},
				],
			},
			{
				to: ['<< track', { action: 'splitClipAt', sub_flow: true }],
				fn: [
					['start', 'in', 'duration', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'mediaKind', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'] as const,
					(payload: unknown, start: unknown, inPoint: unknown, duration: unknown,
						sourceResourceId: unknown, sourceTextId: unknown, name: unknown, color: unknown,
						mediaKind: unknown, fadeIn: unknown, fadeOut: unknown, audio: unknown, opacity: unknown,
						transform: unknown) => {
						const time = (payload as { time?: unknown } | null)?.time
						const s = typeof start === 'number' ? start : 0
						const ip = typeof inPoint === 'number' ? inPoint : 0
						const d = typeof duration === 'number' ? duration : 0
						if (typeof time !== 'number' || time <= s || time >= s + d) return '$noop'
						const seq = ++splitClipSequence
						return {
							sourceClipId: `clip:split-right:${seq}`,
							sourceResourceId: typeof sourceResourceId === 'string' ? sourceResourceId : null,
							sourceTextId: typeof sourceTextId === 'string' ? sourceTextId : null,
							name: typeof name === 'string' ? name : 'Clip',
							color: typeof color === 'string' ? color : '#2563eb',
							mediaKind: typeof mediaKind === 'string' ? mediaKind : 'video',
							start: time,
							in: ip + (time - s),
							duration: roundToTenths(s + d - time),
							fadeIn: 0,
							fadeOut: typeof fadeOut === 'number' ? fadeOut : 0,
							audio: audio && typeof audio === 'object' ? audio : { gain: 1, pan: 0 },
							opacity: opacity && typeof opacity === 'object' ? opacity : { value: 1 },
							transform: transform && typeof transform === 'object' ? transform : defaultClipTransform,
							splitTime: time,
							sourceClip: { start: s, in: ip, duration: d },
						}
					},
				],
			},
		],
	},
})

export const CLIP_CREATION_SHAPE = {
	attrs: ['sourceClipId', 'sourceResourceId', 'sourceTextId', 'name', 'color', 'mediaKind', 'start', 'in', 'duration', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'],
} as const
