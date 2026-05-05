import { model } from 'dkt/model.js'

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
	},
})