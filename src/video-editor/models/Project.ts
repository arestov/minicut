import { model } from 'dkt/model.js'
import { RESOURCE_CREATION_SHAPE } from './Resource'
import { TRACK_CREATION_SHAPE } from './Track'
import { normalizeResourceCreationAttrs, normalizeTrackCreationAttrs } from './Project/actions'

export const PROJECT_CREATION_SHAPE = {
	attrs: ['sourceProjectId', 'title', 'fps', 'width', 'height', 'duration', 'createdAt', 'updatedAt', 'autoCreateDefaultTracks'],
	rels: {
		tracks: TRACK_CREATION_SHAPE,
		resources: RESOURCE_CREATION_SHAPE,
	},
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
		timelineDuration: ['comp', ['duration'], (duration: unknown) => asNumber(duration, 0)],
		resourceCount: ['input', 0],
		trackCount: ['input', 0],
		previewFrame: ['input', null],
		exportPlanStatus: ['input', 'idle'],
		timelineSummary: ['comp', ['timelineDuration', 'trackCount'], (timelineDuration: unknown, trackCount: unknown) => ({
			duration: asNumber(timelineDuration, 0),
			trackCount: asNumber(trackCount, 0),
		})],
		resourceSummary: ['comp', ['resourceCount'], (resourceCount: unknown) => ({
			count: asNumber(resourceCount, 0),
		})],
		createdAt: ['input', 0],
		updatedAt: ['input', 0],
		autoCreateDefaultTracks: ['input', false],
		isLandscape: ['comp', ['width', 'height'], (width: unknown, height: unknown) => asNumber(width, 0) >= asNumber(height, 0)],
	},
	rels: {
		tracks: ['input', { many: true, linking: '<< track << #' }],
		resources: ['input', { many: true, linking: '<< resource << #' }],
	},
	actions: {
		handleInit: {
			when: [
				['autoCreateDefaultTracks'] as const,
				(_payload: unknown, autoCreateDefaultTracks: unknown) => autoCreateDefaultTracks === true,
			],
			to: {
				videoTrack: ['<< track << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: TRACK_CREATION_SHAPE,
				}],
				audioTrack: ['<< track << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: TRACK_CREATION_SHAPE,
				}],
				tracks: ['<< tracks', {
					method: 'set_many',
					can_use_refs: true,
				}],
			},
			fn: [
				['sourceProjectId', 'autoCreateDefaultTracks'] as const,
				(_payload: unknown, sourceProjectId: unknown, autoCreateDefaultTracks: unknown) => {
					if (typeof sourceProjectId !== 'string' || !sourceProjectId || autoCreateDefaultTracks !== true) {
						return '$noop'
					}

					return {
						videoTrack: {
							attrs: {
								sourceTrackId: `${sourceProjectId}:track:video`,
								kind: 'video',
								name: 'V1',
								muted: false,
								locked: false,
								height: 72,
							},
							hold_ref_id: 'defaultVideoTrack',
						},
						audioTrack: {
							attrs: {
								sourceTrackId: `${sourceProjectId}:track:audio`,
								kind: 'audio',
								name: 'A1',
								muted: false,
								locked: false,
								height: 64,
							},
							hold_ref_id: 'defaultAudioTrack',
						},
						tracks: [
							{ use_ref_id: 'defaultVideoTrack' },
							{ use_ref_id: 'defaultAudioTrack' },
						],
					}
				},
			],
		},
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
			to: {
				track: ['<< track << #', {
					method: 'at_end',
					can_create: true,
					can_hold_refs: true,
					creation_shape: TRACK_CREATION_SHAPE,
				}],
				tracks: ['<< tracks', {
					method: 'at_end',
					can_use_refs: true,
				}],
			},
			fn: (payload: unknown) => {
				const attrs = normalizeTrackCreationAttrs(payload)
				return attrs
					? {
						track: { attrs, hold_ref_id: 'newTrack' },
						tracks: { use_ref_id: 'newTrack' },
					}
					: '$noop'
			},
		},
		importResource: [
			{
				to: {
					resource: ['<< resource << #', {
						method: 'at_end',
						can_create: true,
						can_hold_refs: true,
						creation_shape: RESOURCE_CREATION_SHAPE,
					}],
					resources: ['<< resources', {
						method: 'at_end',
						can_use_refs: true,
					}],
					$output: ['$output'],
				},
				fn: [
					['<< @all:tracks.clips', 'sourceProjectId'] as const,
					(payload: unknown, clips: unknown[], sourceProjectId: unknown) => {
						const attrs = normalizeResourceCreationAttrs({
							...(payload && typeof payload === 'object' ? payload : {}),
							sourceProjectId,
						})
						if (!attrs) {
							return '$noop'
						}
						const hasTimelineClips = Array.isArray(clips) && clips.some(Boolean)

						return {
							resource: { attrs, hold_ref_id: 'newResource' },
							resources: { use_ref_id: 'newResource' },
							$output: {
								resource: attrs,
								shouldAddToTimeline: !hasTimelineClips,
							},
						}
					},
				],
			},
			{
				when: [
					[] as const,
					(payload: unknown) => (payload as { shouldAddToTimeline?: unknown } | null)?.shouldAddToTimeline === true,
				],
				to: ['<< @one:tracks', { action: 'addClip', inline_subwalker: true }],
				fn: (payload: unknown) => {
					const value = payload as { resource?: Record<string, unknown>; shouldAddToTimeline?: unknown } | null
					const resource = value?.resource
					const sourceResourceId = typeof resource?.sourceResourceId === 'string' ? resource.sourceResourceId : null
					if (!sourceResourceId || value?.shouldAddToTimeline !== true) {
						return '$noop'
					}

					return {
						sourceClipId: `${sourceResourceId}:clip`,
						sourceResourceId,
						name: typeof resource.name === 'string' ? resource.name : 'Clip',
						mediaKind: typeof resource.kind === 'string' ? resource.kind : 'video',
						start: 0,
						in: 0,
						duration: typeof resource.duration === 'number' ? resource.duration : 0,
					}
				},
			},
		],
		setTracks: {
			to: {
				tracks: ['<< tracks', { method: 'set_many' }],
			},
			fn: (payload: unknown) => {
				const tracks = (payload as { tracks?: unknown } | null)?.tracks
				return { tracks: Array.isArray(tracks) ? tracks : [] }
			},
		},
		setResources: {
			to: {
				resources: ['<< resources', { method: 'set_many' }],
			},
			fn: (payload: unknown) => {
				const resources = (payload as { resources?: unknown } | null)?.resources
				return { resources: Array.isArray(resources) ? resources : [] }
			},
		},
	},
})