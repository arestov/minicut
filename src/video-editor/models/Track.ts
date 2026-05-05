import { model } from 'dkt/model.js'
import { CLIP_PROXY_CREATION_SHAPE } from './Clip'
import { TEXT_PROXY_CREATION_SHAPE } from './Text'
import { normalizeClipCreationAttrs, normalizeRightSplitClipAttrs, normalizeTextCreationAttrs, removeClipRef } from './Track/actions'

export const TRACK_PROXY_CREATION_SHAPE = {
	attrs: ['sourceTrackId', 'kind', 'name', 'muted', 'locked', 'height'],
} as const

export const Track = model({
	model_name: 'minicut_track',
	attrs: {
		sourceTrackId: ['input', ''],
		kind: ['input', 'video'],
		name: ['input', 'Track'],
		muted: ['input', false],
		locked: ['input', false],
		height: ['input', 84],
	},
	rels: {
		clips: ['input', { many: true, linking: '<< clip << #' }],
		text: ['input', { many: true, linking: '<< text << #' }],
	},
	actions: {
		renameTrack: {
			to: {
				name: ['name'],
			},
			fn: (payload: unknown) => {
				const name = typeof payload === 'string'
					? payload
					: (payload as { name?: unknown } | null)?.name
				return typeof name === 'string' && name ? { name } : '$noop'
			},
		},
		setTrackMuted: {
			to: {
				muted: ['muted'],
			},
			fn: (payload: unknown) => {
				const muted = typeof payload === 'boolean'
					? payload
					: (payload as { muted?: unknown } | null)?.muted
				return typeof muted === 'boolean' ? { muted } : '$noop'
			},
		},
		setTrackLocked: {
			to: {
				locked: ['locked'],
			},
			fn: (payload: unknown) => {
				const locked = typeof payload === 'boolean'
					? payload
					: (payload as { locked?: unknown } | null)?.locked
				return typeof locked === 'boolean' ? { locked } : '$noop'
			},
		},
		addClip: {
			to: ['<< clip << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: CLIP_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const attrs = normalizeClipCreationAttrs(payload)
				return attrs ? { attrs } : '$noop'
			},
		},
		addTextClip: {
			to: {
				clip: ['<< clip << #', {
					method: 'at_end',
					can_create: true,
					creation_shape: CLIP_PROXY_CREATION_SHAPE,
				}],
				text: ['<< text << #', {
					method: 'at_end',
					can_create: true,
					creation_shape: TEXT_PROXY_CREATION_SHAPE,
				}],
			},
			fn: (payload: unknown) => {
				const value = payload as { text?: unknown } | null
				const clipAttrs = normalizeClipCreationAttrs(payload)
				const textAttrs = normalizeTextCreationAttrs(value?.text)
				return clipAttrs && textAttrs
					? { clip: { attrs: clipAttrs }, text: { attrs: textAttrs } }
					: '$noop'
			},
		},
		splitClipAt: {
			to: ['<< clip << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: CLIP_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const attrs = normalizeRightSplitClipAttrs(payload)
				return attrs ? { attrs } : '$noop'
			},
		},
		setClips: {
			to: {
				clips: ['<< clips', { method: 'set_many' }],
			},
			fn: (payload: unknown) => {
				const clips = (payload as { clips?: unknown } | null)?.clips
				return { clips: Array.isArray(clips) ? clips : [] }
			},
		},
		removeClip: {
			to: {
				clips: ['<< clips', { method: 'set_many' }],
			},
			fn: [
				['<< @all:clips'] as const,
				(payload: unknown, clips: unknown[]) => {
					const clipId = (payload as { clipId?: unknown } | null)?.clipId ?? payload
					const nextClips = removeClipRef(Array.isArray(clips) ? clips : [], clipId)
					return nextClips ? { clips: nextClips } : '$noop'
				},
			],
		},
	},
})