import { model } from 'dkt/model.js'
import { RESOURCE_CREATION_SHAPE } from './Resource'
import { TRACK_CREATION_SHAPE } from './Track'
import {
	normalizeResourceCreationAttrs,
	normalizeTrackCreationAttrs,
	findResourceBySourceId,
	createTimelineClipPayload,
	createEmbeddedAudioClipPayload,
	reduceHandleInit,
	reduceRenameProject,
	reduceSetProjectFormat,
	reduceSetProjectDuration,
	reduceAddTrack,
	reduceImportResourceCreate,
	reduceImportResourceToVideo,
	reduceImportResourceToAudio,
	reduceImportResourceToEmbeddedAudio,
	reduceRequestImportFiles,
	reduceCreateImportFilesEffectPayload,
	reduceSetImportProgress,
	reduceSetTracks,
	reduceSetResources,
	reduceAddVideoResourceToTimeline,
	reduceAddAudioResourceToTimeline,
	reduceAddEmbeddedAudio,
	reduceAddTextClipToVideoTrack,
} from './Project/actions'
import { PROJECT_IMPORT_FILES_FX } from './Project/effects'
import { reduceProjectPreviewClipSources } from './Project/comps'
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
		importProgress: ['input', null],
		lastImportError: ['input', null],
		activeImportTaskId: ['input', null],
		previewFrame: ['input', null],
		createdAt: ['input', 0],
		updatedAt: ['input', 0],
		autoCreateDefaultTracks: ['input', false],
		isLandscape: ['comp', ['width', 'height'], (width: unknown, height: unknown) => asNumber(width, 0) >= asNumber(height, 0)],
		resourceTransferManifest: ['comp', ['< @all:transferSnapshot < resources'] as const, (snapshots: unknown) => {
			if (!Array.isArray(snapshots)) {
				return []
			}
			return snapshots
				.map((entry) => {
					const item = entry as {
						sourceResourceId?: unknown
						name?: unknown
						kind?: unknown
						url?: unknown
						mime?: unknown
						duration?: unknown
						width?: unknown
						height?: unknown
						size?: unknown
						source?: unknown
						status?: unknown
						data?: unknown
					} | null
					if (!item || typeof item.sourceResourceId !== 'string' || !item.sourceResourceId) {
						return null
					}
					return {
						resourceId: item.sourceResourceId,
						attrs: {
							name: typeof item.name === 'string' ? item.name : item.sourceResourceId,
							kind: item.kind === 'audio' || item.kind === 'image' || item.kind === 'text' ? item.kind : 'video',
							url: typeof item.url === 'string' ? item.url : '',
							mime: typeof item.mime === 'string' ? item.mime : 'application/octet-stream',
							duration: typeof item.duration === 'number' && Number.isFinite(item.duration) ? item.duration : 0,
							width: typeof item.width === 'number' && Number.isFinite(item.width) ? item.width : undefined,
							height: typeof item.height === 'number' && Number.isFinite(item.height) ? item.height : undefined,
							size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : undefined,
							source: item.source && typeof item.source === 'object' ? item.source : { kind: 'local' },
							status: typeof item.status === 'string' ? item.status : 'missing',
							data: item.data && typeof item.data === 'object' ? item.data : {},
						},
					}
				})
				.filter((entry): entry is { resourceId: string; attrs: Record<string, unknown> } => entry !== null)
		}],
		previewClipSources: ['comp', ['< @all:clipRenderData < tracks.clips'] as const,
			reduceProjectPreviewClipSources],
	},
	effects: {
		api: {
			importRuntime: [
				['_node_id'] as const,
				['#importRuntime'] as const,
				(importRuntime: unknown) => importRuntime,
			],
		},
		out: {
			[PROJECT_IMPORT_FILES_FX]: {
				api: ['importRuntime'],
				create_when: { api_inits: true },
				fn: (api: unknown, state: unknown) => {
					const runtime = api as { requestImportFiles?: (payload: unknown) => void } | null
					const payload = (state as { payload?: unknown } | null)?.payload
					if (!runtime || typeof runtime.requestImportFiles !== 'function' || !payload || typeof payload !== 'object') {
						return
					}
					runtime.requestImportFiles(payload)
				},
			},
		},
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
				reduceHandleInit,
			],
		},
		renameProject: {
			to: {
				title: ['title'],
			},
			fn: reduceRenameProject,
		},
		setProjectFormat: {
			to: {
				fps: ['fps'],
				width: ['width'],
				height: ['height'],
			},
			fn: reduceSetProjectFormat,
		},
		setProjectDuration: {
			to: {
				duration: ['duration'],
			},
			fn: reduceSetProjectDuration,
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
			fn: reduceAddTrack,
		},
		requestImportFiles: [
			{
				to: {
					activeImportTaskId: ['activeImportTaskId'],
					importProgress: ['importProgress'],
					lastImportError: ['lastImportError'],
				},
				fn: reduceRequestImportFiles,
			},
			{
				to: [PROJECT_IMPORT_FILES_FX, { intent: 'call', drop_when_api_not_ready: false }],
				fn: [
					['sourceProjectId'] as const,
					reduceCreateImportFilesEffectPayload,
				],
			},
		],
		setImportProgress: {
			to: {
				activeImportTaskId: ['activeImportTaskId'],
				importProgress: ['importProgress'],
				lastImportError: ['lastImportError'],
			},
			fn: reduceSetImportProgress,
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
					reduceImportResourceCreate,
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
					reduceImportResourceToVideo,
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
					reduceImportResourceToAudio,
				],
			},
			{
				when: [
					[] as const,
					(payload: unknown) => {
						const value = payload as { shouldAddEmbeddedAudio?: unknown; resource?: { kind?: unknown } } | null
						return value?.shouldAddEmbeddedAudio === true && value?.resource?.kind === 'video'
					},
				],
				to: ['<< primaryAudioTrack', { action: 'addClip', inline_subwalker: true }],
				fn: [
					['$noop', '< @one:appendStart < primaryAudioTrack'] as const,
					reduceImportResourceToEmbeddedAudio,
				],
			},
		],
		setTracks: {
			to: {
				tracks: ['<< tracks', { method: 'set_many' }],
			},
			fn: reduceSetTracks,
		},
		setResources: {
			to: {
				resources: ['<< resources', { method: 'set_many' }],
			},
			fn: reduceSetResources,
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
					reduceAddVideoResourceToTimeline,
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
					reduceAddAudioResourceToTimeline,
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
					reduceAddEmbeddedAudio,
				],
			},
		],
		addTextClipToVideoTrack: [
			{
				to: ['<< primaryVideoTrack', { action: 'addTextClip', inline_subwalker: true }],
				fn: reduceAddTextClipToVideoTrack,
			},
		],
	},
})
