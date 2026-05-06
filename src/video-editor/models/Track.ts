import { model } from 'dkt/model.js'
import { CLIP_CREATION_SHAPE } from './Clip'
import { TEXT_CREATION_SHAPE } from './Text'
import { normalizeClipCreationAttrs, normalizeRightSplitClipAttrs, normalizeTextCreationAttrs, removeClipRef, removeClipBySourceClipId } from './Track/actions'

export const TRACK_CREATION_SHAPE = {
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
		isVisible: ['input', true],
		height: ['input', 84],
		trackDuration: ['input', 0],
		clipCount: ['input', 0],
		laneRenderState: ['comp', ['muted', 'locked', 'isVisible'], (muted: unknown, locked: unknown, isVisible: unknown) => ({
			muted: muted === true,
			locked: locked === true,
			isVisible: isVisible !== false,
		})],
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
			when: [
				[] as const,
				(payload: unknown) => typeof (payload as { sourceClipId?: unknown } | null)?.sourceClipId === 'string',
			],
			to: {
				clip: ['<< clip << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: CLIP_CREATION_SHAPE,
				}],
				clips: ['<< clips', {
					method: 'at_end',
					can_use_refs: true,
				}],
			},
			fn: (payload: unknown) => {
				const attrs = normalizeClipCreationAttrs(payload)
				return attrs
					? {
						clip: { attrs, hold_ref_id: 'newClip' },
						clips: { use_ref_id: 'newClip' },
					}
					: '$noop'
			},
		},
		addTextClip: {
			to: {
				clip: ['<< clip << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: CLIP_CREATION_SHAPE,
				}],
				text: ['<< text << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: TEXT_CREATION_SHAPE,
				}],
				clips: ['<< clips', {
					method: 'at_end',
					can_use_refs: true,
				}],
			},
			fn: (payload: unknown) => {
				const value = payload as { text?: unknown } | null
				const clipAttrs = normalizeClipCreationAttrs(payload)
				const textAttrs = normalizeTextCreationAttrs(value?.text)
				return clipAttrs && textAttrs
					? {
						clip: { attrs: clipAttrs, hold_ref_id: 'newTextClip' },
						text: { attrs: textAttrs, hold_ref_id: 'newTextNode' },
						clips: { use_ref_id: 'newTextClip' },
					}
					: '$noop'
			},
		},
		splitClipAt: {
			to: {
				clip: ['<< clip << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: CLIP_CREATION_SHAPE,
				}],
				clips: ['<< clips', {
					method: 'at_end',
					can_use_refs: true,
				}],
			},
			fn: (payload: unknown) => {
				const attrs = normalizeRightSplitClipAttrs(payload)
				return attrs
					? {
						clip: { attrs, hold_ref_id: 'rightSplitClip' },
						clips: { use_ref_id: 'rightSplitClip' },
					}
					: '$noop'
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
		removeClipBySourceId: {
			to: {
				clips: ['<< clips', { method: 'set_many' }],
			},
			fn: [
				['<< @all:clips'] as const,
				(payload: unknown, clips: unknown[]) => {
					const sourceClipId = (payload as { sourceClipId?: unknown } | null)?.sourceClipId ?? payload
					const nextClips = removeClipBySourceClipId(Array.isArray(clips) ? clips : [], sourceClipId)
					return nextClips ? { clips: nextClips } : '$noop'
				},
			],
		},
	},
})