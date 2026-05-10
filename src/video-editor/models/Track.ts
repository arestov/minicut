import { model } from 'dkt/model.js'
import { CLIP_CREATION_SHAPE } from './Clip'
import { TEXT_CREATION_SHAPE } from './Text'
import {
	normalizeClipCreationAttrs, normalizeRightSplitClipAttrs, normalizeTextCreationAttrs, removeClipRef,
	reduceRenameTrack, reduceSetTrackMuted, reduceSetTrackLocked,
	reduceAddClip, reduceAddTextClip, reduceSplitClipAt,
	reduceSetClips, reduceRemoveClip,
} from './Track/actions'
import { reduceTrackAppendStart } from './Track/comps'

export const TRACK_CREATION_SHAPE = {
	attrs: ['kind', 'name', 'muted', 'locked', 'height'],
} as const

export const Track = model({
	model_name: 'minicut_track',
	attrs: {
		kind: ['input', 'video'],
		name: ['input', 'Track'],
		muted: ['input', false],
		locked: ['input', false],
		isVisible: ['input', true],
		height: ['input', 84],
		trackDuration: ['input', 0],
		clipCount: ['input', 0],
		appendStart: ['comp', ['< @all:start < clips', '< @all:duration < clips'] as const,
			reduceTrackAppendStart],
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
	},
})
