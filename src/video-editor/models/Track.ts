import { model } from 'dkt/model.js'
import { CLIP_CREATION_SHAPE } from './Clip'
import { TEXT_CREATION_SHAPE } from './Text'
import {
	normalizeClipCreationAttrs, normalizeRightSplitClipAttrs, normalizeTextCreationAttrs, removeClipRef, removeClipBySourceClipId,
	reduceRenameTrack, reduceSetTrackMuted, reduceSetTrackLocked,
	reduceAddClip, reduceAddTextClip, reduceSplitClipAt,
	reduceSetClips, reduceRemoveClip, reduceRemoveClipBySourceId,
} from './Track/actions'

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
		appendStart: ['comp', ['< @all:start < clips', '< @all:duration < clips'] as const,
			(starts: unknown, durations: unknown): number => {
				const s = Array.isArray(starts) ? starts : []
				const d = Array.isArray(durations) ? durations : []
				let maxEnd = 0
				const len = Math.max(s.length, d.length)
				for (let i = 0; i < len; i += 1) {
					const sv = typeof s[i] === 'number' && Number.isFinite(s[i]) ? s[i] : 0
					const dv = typeof d[i] === 'number' && Number.isFinite(d[i]) ? d[i] : 0
					maxEnd = Math.max(maxEnd, sv + dv)
				}
				return maxEnd
			}],
		laneRenderState: ['comp', ['muted', 'locked', 'isVisible'], (muted: unknown, locked: unknown, isVisible: unknown) => ({
			muted: muted === true,
			locked: locked === true,
			isVisible: isVisible !== false,
		})],
	},
	rels: {
		clips: ['input', { many: true, linking: '<< clip << #' }],
		project: ['input', { linking: '<< project << #' }],
	},
	actions: {
		renameTrack: {
			to: {
				name: ['name'],
			},
			fn: reduceRenameTrack,
		},
		setTrackMuted: {
			to: {
				muted: ['muted'],
			},
			fn: reduceSetTrackMuted,
		},
		setTrackLocked: {
			to: {
				locked: ['locked'],
			},
			fn: reduceSetTrackLocked,
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
			fn: [['<<<<'] as const, reduceAddClip],
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
			fn: [['<<<<'] as const, reduceAddTextClip],
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
			fn: [['<<<<'] as const, reduceSplitClipAt],
		},
		setClips: {
			to: {
				clips: ['<< clips', { method: 'set_many' }],
			},
			fn: reduceSetClips,
		},
		removeClip: {
			to: {
				clips: ['<< clips', { method: 'set_many' }],
			},
			fn: [['<< @all:clips'] as const, reduceRemoveClip],
		},
		removeClipBySourceId: {
			to: {
				clips: ['<< clips', { method: 'set_many' }],
			},
			fn: [['<< @all:clips'] as const, reduceRemoveClipBySourceId],
		},
	},
})