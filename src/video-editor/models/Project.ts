import { model } from 'dkt/model.js'
import { RESOURCE_PROXY_CREATION_SHAPE } from './Resource'
import { TRACK_PROXY_CREATION_SHAPE } from './Track'
import { normalizeResourceCreationAttrs, normalizeTrackCreationAttrs } from './Project/actions'

export const PROJECT_PROXY_CREATION_SHAPE = {
	attrs: ['sourceProjectId', 'title', 'fps', 'width', 'height', 'duration', 'createdAt', 'updatedAt'],
} as const

const asNumber = (value: unknown, fallback: number): number => typeof value === 'number' ? value : fallback

export const Project = model({
	model_name: 'minicut_project',
	attrs: {
		sourceProjectId: ['input', ''],
		title: ['input', 'Untitled project'],
		fps: ['input', 30],
		width: ['input', 1920],
		height: ['input', 1080],
		duration: ['input', 0],
		createdAt: ['input', 0],
		updatedAt: ['input', 0],
		isLandscape: ['comp', ['width', 'height'], (width: unknown, height: unknown) => asNumber(width, 0) >= asNumber(height, 0)],
	},
	rels: {
		tracks: ['input', { many: true, linking: '<< track << #' }],
		resources: ['input', { many: true, linking: '<< resource << #' }],
	},
	actions: {
		renameProject: {
			to: {
				title: ['title'],
			},
			fn: (payload: unknown) => {
				const title = typeof payload === 'string'
					? payload
					: (payload as { title?: unknown } | null)?.title
				return typeof title === 'string' && title ? { title } : '$noop'
			},
		},
		setProjectFormat: {
			to: {
				fps: ['fps'],
				width: ['width'],
				height: ['height'],
			},
			fn: (payload: unknown) => {
				const value = payload as { fps?: unknown; width?: unknown; height?: unknown } | null
				return value && typeof value === 'object'
					? {
						fps: asNumber(value.fps, 30),
						width: asNumber(value.width, 1920),
						height: asNumber(value.height, 1080),
					}
					: '$noop'
			},
		},
		setProjectDuration: {
			to: {
				duration: ['duration'],
			},
			fn: (payload: unknown) => {
				const duration = typeof payload === 'number'
					? payload
					: (payload as { duration?: unknown } | null)?.duration
				return typeof duration === 'number' ? { duration: Math.max(0, duration) } : '$noop'
			},
		},
		addTrack: {
			to: ['<< track << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: TRACK_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const attrs = normalizeTrackCreationAttrs(payload)
				return attrs ? { attrs } : '$noop'
			},
		},
		importResource: {
			to: ['<< resource << #', {
				method: 'at_end',
				can_create: true,
				creation_shape: RESOURCE_PROXY_CREATION_SHAPE,
			}],
			fn: (payload: unknown) => {
				const attrs = normalizeResourceCreationAttrs(payload)
				return attrs ? { attrs } : '$noop'
			},
		},
	},
})