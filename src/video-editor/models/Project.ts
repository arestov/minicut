import { model } from 'dkt/model.js'
import { RESOURCE_CREATION_SHAPE } from './Resource'
import { TRACK_CREATION_SHAPE } from './Track'
import { normalizeResourceCreationAttrs, normalizeTrackCreationAttrs } from './Project/actions'
import type { PreviewClipSource, PreviewStructure } from '../read-model/previewComps'
import { normalizeExportPlan, type ExportPlan } from '../render/renderPlan'

export const PROJECT_CREATION_SHAPE = {
	attrs: ['sourceProjectId', 'title', 'fps', 'width', 'height', 'duration', 'createdAt', 'updatedAt', 'autoCreateDefaultTracks'],
	rels: {
		tracks: TRACK_CREATION_SHAPE,
		resources: RESOURCE_CREATION_SHAPE,
	},
} as const

const asNumber = (value: unknown, fallback: number): number => typeof value === 'number' ? value : fallback

const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

type TimelineResourceSummary = {
	sourceResourceId: string
	kind: string
	duration: number
	url?: string
	mime?: string
}

const hydrateClipSourcesWithResourceSummaries = (
	clipSources: PreviewClipSource[],
	resourceSummaries: TimelineResourceSummary[],
): PreviewClipSource[] => {
	if (clipSources.length === 0 || resourceSummaries.length === 0) {
		return clipSources
	}

	const byResourceId = new Map<string, TimelineResourceSummary>()
	for (const summary of resourceSummaries) {
		if (!summary || typeof summary !== 'object' || !summary.sourceResourceId) {
			continue
		}
		byResourceId.set(summary.sourceResourceId, summary)
	}

	if (byResourceId.size === 0) {
		return clipSources
	}

	return clipSources.map((clipSource) => {
		if (typeof clipSource.resourceId !== 'string' || !clipSource.resourceId) {
			return clipSource
		}
		const summary = byResourceId.get(clipSource.resourceId)
		if (!summary) {
			return clipSource
		}

		const resolvedUrl = asString(summary.url, '').trim()
		const resolvedMime = asString(summary.mime, '').trim()
		const resolvedKind = asString(summary.kind, '').trim()
		const resolvedDuration = Number.isFinite(summary.duration) ? Math.max(0, summary.duration) : clipSource.duration

		if (
			clipSource.resourceUrl
			&& clipSource.mime
			&& Number.isFinite(clipSource.duration)
			&& clipSource.duration > 0
		) {
			return clipSource
		}

		return {
			...clipSource,
			resourceUrl: clipSource.resourceUrl || resolvedUrl,
			mime: clipSource.mime !== 'application/octet-stream' ? clipSource.mime : (resolvedMime || clipSource.mime),
			resourceKind: clipSource.resourceKind !== 'video'
				? clipSource.resourceKind
				: (resolvedKind === 'audio' || resolvedKind === 'image' || resolvedKind === 'video' || resolvedKind === 'text'
					? resolvedKind
					: clipSource.resourceKind),
			duration: clipSource.duration > 0 ? clipSource.duration : resolvedDuration,
		}
	})
}

const findResourceBySourceId = (resources: unknown[], sourceResourceId: string): Record<string, unknown> | null => {
	if (!Array.isArray(resources)) return null
	for (const resource of resources) {
		if (resource && typeof resource === 'object' && (resource as Record<string, unknown>).sourceResourceId === sourceResourceId) {
			return resource as Record<string, unknown>
		}
	}
	return null
}

const createClipIdFromResourceId = (resourceId: string): string => `${resourceId}:clip`

const createTimelineClipPayload = (
	noop: unknown,
	resource: Record<string, unknown>,
	overrides: Partial<{
		sourceClipId: string
		name: string
		mediaKind: string
	}> = {},
	sourceResourceName?: string | null,
	appendStart?: number,
) => {
	const sourceResourceId = typeof resource.sourceResourceId === 'string' ? resource.sourceResourceId : null
	if (!sourceResourceId) {
		return noop
	}

	return {
		sourceClipId: overrides.sourceClipId ?? createClipIdFromResourceId(sourceResourceId),
		sourceResourceId,
		name: overrides.name ?? (typeof resource.name === 'string' ? resource.name : 'Clip'),
		mediaKind: overrides.mediaKind ?? (typeof resource.kind === 'string' ? resource.kind : 'video'),
				sourceResourceName: sourceResourceName !== undefined ? sourceResourceName : null,
		start: typeof appendStart === 'number' ? appendStart : 0,
		in: 0,
		duration: typeof resource.duration === 'number' ? resource.duration : 0,
	}
}

const createEmbeddedAudioClipPayload = (noop: unknown, resource: Record<string, unknown>, appendStart?: number) => {
	if (resource.kind !== 'video') {
		return noop
	}

	const sourceResourceId = typeof resource.sourceResourceId === 'string' ? resource.sourceResourceId : null
	if (!sourceResourceId) {
		return noop
	}

	return createTimelineClipPayload(noop, resource, {
		sourceClipId: `${sourceResourceId}:audio-clip`,
		name: 'Embedded audio',
		mediaKind: 'audio',
	}, typeof resource.name === 'string' ? resource.name : null, appendStart)
}

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
		previewFrame: ['input', null],
		createdAt: ['input', 0],
		updatedAt: ['input', 0],
		autoCreateDefaultTracks: ['input', false],
		isLandscape: ['comp', ['width', 'height'], (width: unknown, height: unknown) => asNumber(width, 0) >= asNumber(height, 0)],
		previewClipSources: ['comp', ['< @all:clipRenderData < tracks.clips'] as const,
			(allTrackClipData: unknown): PreviewStructure => {
				const sources: PreviewClipSource[] = []
				if (Array.isArray(allTrackClipData)) {
					for (const clipData of allTrackClipData) {
						if (clipData && typeof clipData === 'object' && 'id' in clipData) {
							sources.push(clipData as PreviewClipSource)
						}
					}
				}
				return { clipSources: sources }
			}],
		exportPlan: ['comp', ['sourceProjectId', 'fps', 'width', 'height', 'duration', 'previewClipSources', '< @all:timelineClipSource < resources'] as const,
			(sourceProjectId: unknown, fps: unknown, width: unknown, height: unknown, duration: unknown, previewClipSources: unknown, resourceSummaries: unknown): ExportPlan => normalizeExportPlan({
				projectId: typeof sourceProjectId === 'string' ? sourceProjectId : '',
				fps: asNumber(fps, 30),
				width: asNumber(width, 1920),
				height: asNumber(height, 1080),
				duration: asNumber(duration, 0),
				clipSources: hydrateClipSourcesWithResourceSummaries(
					previewClipSources && typeof previewClipSources === 'object' && Array.isArray((previewClipSources as PreviewStructure).clipSources)
						? (previewClipSources as PreviewStructure).clipSources
						: [],
					Array.isArray(resourceSummaries)
						? resourceSummaries as TimelineResourceSummary[]
						: [],
				),
			})],
	},
	rels: {
		tracks: ['input', { many: true, linking: '<< track << #' }],
		resources: ['input', { many: true, linking: '<< resource << #' }],
		primaryVideoTrack: ['input', { linking: '<< track << #' }],
		primaryAudioTrack: ['input', { linking: '<< track << #' }],
	},
	actions: {
		handleInit: {
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
				primaryVideoTrack: ['<< primaryVideoTrack', {
					method: 'set_one',
					can_use_refs: true,
				}],
				primaryAudioTrack: ['<< primaryAudioTrack', {
					method: 'set_one',
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
						primaryVideoTrack: { use_ref_id: 'defaultVideoTrack' },
						primaryAudioTrack: { use_ref_id: 'defaultAudioTrack' },
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
						const hasTimelineClips = Array.isArray(clips) && clips.some((entry) => {
							if (Array.isArray(entry)) {
								return entry.length > 0
							}

							return Boolean(entry)
						})

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
				to: ['<< primaryVideoTrack', { action: 'addClip', inline_subwalker: true }],
				fn: [
					['$noop'] as const,
					(payload: unknown, noop: unknown) => {
					const value = payload as { resource?: Record<string, unknown>; shouldAddToTimeline?: unknown } | null
					const resource = value?.resource ?? {}
					if (value?.shouldAddToTimeline !== true || resource.kind === 'audio') {
						return noop
					}

					return createTimelineClipPayload(noop, resource)
					},
				],
			},
			{
				when: [
					[] as const,
					(payload: unknown) => {
						const value = payload as { shouldAddToTimeline?: unknown; resource?: { kind?: unknown } } | null
						return value?.shouldAddToTimeline === true && value?.resource?.kind === 'audio'
					},
				],
				to: ['<< primaryAudioTrack', { action: 'addClip', inline_subwalker: true }],
				fn: [
					['$noop'] as const,
					(payload: unknown, noop: unknown) => {
					const value = payload as { resource?: Record<string, unknown>; shouldAddToTimeline?: unknown } | null
					const resource = value?.resource ?? {}
					if (value?.shouldAddToTimeline !== true) {
						return noop
					}

					return createTimelineClipPayload(noop, resource)
					},
				],
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
		addResourceToTimeline: [
			{
				when: [
					['< @all:timelineClipSource < resources'] as const,
					(payload: unknown, resources: unknown[]) => {
						const sourceResourceId = (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId
						if (typeof sourceResourceId !== 'string') return false
						const resource = findResourceBySourceId(Array.isArray(resources) ? resources : [], sourceResourceId)
						return resource != null && resource.kind !== 'audio'
					},
				],
				to: ['<< primaryVideoTrack', { action: 'addClip', inline_subwalker: true }],
				fn: [
					['$noop', '< @all:timelineClipSource < resources', '< @one:appendStart < primaryVideoTrack', '< @one:appendStart < primaryAudioTrack'] as const,
					(payload: unknown, noop: unknown, resources: unknown[], videoTrackAppendStart: unknown, audioTrackAppendStart: unknown) => {
						const sourceResourceId = (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId
						if (typeof sourceResourceId !== 'string') {
							return noop
						}
						const resource = findResourceBySourceId(Array.isArray(resources) ? resources : [], sourceResourceId)
						if (!resource) {
							return noop
						}
						const start = Math.max(
							typeof videoTrackAppendStart === 'number' ? videoTrackAppendStart : 0,
							typeof audioTrackAppendStart === 'number' ? audioTrackAppendStart : 0,
						)
						return createTimelineClipPayload(noop, resource, {}, undefined, start)
					},
				],
			},
			{
				when: [
					['< @all:timelineClipSource < resources'] as const,
					(payload: unknown, resources: unknown[]) => {
						const sourceResourceId = (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId
						if (typeof sourceResourceId !== 'string') return false
						const resource = findResourceBySourceId(Array.isArray(resources) ? resources : [], sourceResourceId)
						return resource != null && resource.kind === 'audio'
					},
				],
				to: ['<< primaryAudioTrack', { action: 'addClip', inline_subwalker: true }],
				fn: [
					['$noop', '< @all:timelineClipSource < resources', '< @one:appendStart < primaryAudioTrack'] as const,
					(payload: unknown, noop: unknown, resources: unknown[], audioTrackAppendStart: unknown) => {
						const sourceResourceId = (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId
						if (typeof sourceResourceId !== 'string') {
							return noop
						}
						const resource = findResourceBySourceId(Array.isArray(resources) ? resources : [], sourceResourceId)
						if (!resource || resource.kind !== 'audio') {
							return noop
						}
					return createTimelineClipPayload(noop, resource, {}, undefined, typeof audioTrackAppendStart === 'number' ? audioTrackAppendStart : 0)
				},
				],
			},
		],
		addEmbeddedAudioToTimeline: [
			{
				when: [
					[] as const,
					(payload: unknown) => typeof (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId === 'string',
				],
				to: ['<< primaryAudioTrack', { action: 'addClip', inline_subwalker: true }],
				fn: [
					['$noop', '< @all:timelineClipSource < resources', '< @one:appendStart < primaryAudioTrack'] as const,
					(payload: unknown, noop: unknown, resources: unknown[], audioTrackAppendStart: unknown) => {
						const sourceResourceId = (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId
						if (typeof sourceResourceId !== 'string') {
							return noop
						}
						const resource = findResourceBySourceId(Array.isArray(resources) ? resources : [], sourceResourceId)
						if (!resource) {
							return noop
						}
						return createEmbeddedAudioClipPayload(noop, resource, typeof audioTrackAppendStart === 'number' ? audioTrackAppendStart : 0)
					},
				],
			},
		],
		addTextClipToVideoTrack: [
			{
				to: ['<< primaryVideoTrack', { action: 'addTextClip', inline_subwalker: true }],
				fn: (payload: unknown) => payload,
			},
		],
	},
})