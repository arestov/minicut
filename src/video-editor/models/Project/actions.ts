import type { MiniCutDktResourceSeed, MiniCutDktTrackSeed } from '../../dkt/runtime/seedTypes'

export type ProjectAddTrackPayload = MiniCutDktTrackSeed
export type ProjectImportResourcePayload = MiniCutDktResourceSeed
export type ProjectRequestImportFilesPayload = {
	inputBatchHandleId?: unknown
}
export type ProjectSetImportProgressPayload = {
	taskId?: unknown
	stage?: unknown
	processed?: unknown
	total?: unknown
	error?: unknown
}

const asString = (value: unknown): string | null => typeof value === 'string' ? value : null
const asNumber = (value: unknown): number | null => typeof value === 'number' ? value : null
const asBoolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null
const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === 'object' ? value as Value : null

export const normalizeTrackCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectAddTrackPayload | null
	const sourceTrackId = asString(value?.sourceTrackId)
	if (!sourceTrackId) {
		return null
	}

	return {
		sourceTrackId,
		kind: value?.kind === 'audio' ? 'audio' : 'video',
		name: asString(value?.name) ?? 'Track',
		muted: asBoolean(value?.muted) ?? false,
		locked: asBoolean(value?.locked) ?? false,
		height: asNumber(value?.height) ?? 84,
	}
}

export const normalizeResourceCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectImportResourcePayload | null
	const sourceResourceId = asString(value?.sourceResourceId)
	if (!sourceResourceId) {
		return null
	}

	return {
		sourceResourceId,
		sourceProjectId: asString((payload as { sourceProjectId?: unknown } | null)?.sourceProjectId),
		name: asString(value?.name) ?? 'Resource',
		kind: asString(value?.kind) ?? 'video',
		url: asString(value?.url) ?? '',
		mime: asString(value?.mime) ?? 'application/octet-stream',
		duration: asNumber(value?.duration) ?? 0,
		width: asNumber(value?.width),
		height: asNumber(value?.height),
		size: asNumber(value?.size),
		source: asObject(value?.source) ?? { kind: 'local' },
		status: asString(value?.status) ?? 'missing',
		data: asObject(value?.data),
	}
}

const asNumberFallback = (value: unknown, fallback: number): number =>
	typeof value === 'number' ? value : fallback

const createClipIdFromResourceId = (resourceId: string): string => `${resourceId}:clip`

export const findResourceBySourceId = (resources: unknown[], sourceResourceId: string): Record<string, unknown> | null => {
	if (!Array.isArray(resources)) return null
	for (const resource of resources) {
		if (resource && typeof resource === 'object' && (resource as Record<string, unknown>).sourceResourceId === sourceResourceId) {
			return resource as Record<string, unknown>
		}
	}
	return null
}

export const createTimelineClipPayload = (
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

export const createEmbeddedAudioClipPayload = (noop: unknown, resource: Record<string, unknown>, appendStart?: number) => {
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

export const reduceHandleInit = (_payload: unknown, sourceProjectId: unknown, autoCreateDefaultTracks: unknown) => {
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
}

export const reduceRenameProject = (payload: unknown) => {
	const title = typeof payload === 'string'
		? payload
		: (payload as { title?: unknown } | null)?.title
	return typeof title === 'string' && title ? { title } : '$noop'
}

export const reduceSetProjectFormat = (payload: unknown) => {
	const value = payload as { fps?: unknown; width?: unknown; height?: unknown } | null
	return value && typeof value === 'object'
		? {
			fps: asNumberFallback(value.fps, 30),
			width: asNumberFallback(value.width, 1920),
			height: asNumberFallback(value.height, 1080),
		}
		: '$noop'
}

export const reduceSetProjectDuration = (payload: unknown) => {
	const duration = typeof payload === 'number'
		? payload
		: (payload as { duration?: unknown } | null)?.duration
	return typeof duration === 'number' ? { duration: Math.max(0, duration) } : '$noop'
}

export const reduceAddTrack = (payload: unknown) => {
	const attrs = normalizeTrackCreationAttrs(payload)
	return attrs
		? {
			track: { attrs, hold_ref_id: 'newTrack' },
			tracks: { use_ref_id: 'newTrack' },
		}
		: '$noop'
}

export const reduceImportResourceCreate = (payload: unknown, clips: unknown[], sourceProjectId: unknown) => {
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
	const shouldAddToTimeline = !hasTimelineClips

	return {
		resource: { attrs, hold_ref_id: 'newResource' },
		resources: { use_ref_id: 'newResource' },
		$output: {
			resource: attrs,
			shouldAddToTimeline,
			shouldAddEmbeddedAudio: shouldAddToTimeline && attrs.kind === 'video',
		},
	}
}

export const reduceImportResourceToVideo = (payload: unknown, noop: unknown) => {
	const value = payload as { resource?: Record<string, unknown>; shouldAddToTimeline?: unknown } | null
	const resource = value?.resource ?? {}
	if (value?.shouldAddToTimeline !== true || resource.kind === 'audio') {
		return noop
	}
	return createTimelineClipPayload(noop, resource)
}

export const reduceImportResourceToAudio = (payload: unknown, noop: unknown) => {
	const value = payload as { resource?: Record<string, unknown>; shouldAddToTimeline?: unknown } | null
	const resource = value?.resource ?? {}
	if (value?.shouldAddToTimeline !== true) {
		return noop
	}
	return createTimelineClipPayload(noop, resource)
}

export const reduceImportResourceToEmbeddedAudio = (payload: unknown, noop: unknown, audioTrackAppendStart: unknown) => {
	const value = payload as { resource?: Record<string, unknown>; shouldAddEmbeddedAudio?: unknown } | null
	const resource = value?.resource ?? {}
	if (value?.shouldAddEmbeddedAudio !== true) {
		return noop
	}
	return createEmbeddedAudioClipPayload(noop, resource, typeof audioTrackAppendStart === 'number' ? audioTrackAppendStart : 0)
}

export const reduceRequestImportFiles = (payload: unknown) => {
	const value = payload as ProjectRequestImportFilesPayload | null
	if (typeof value?.inputBatchHandleId !== 'string' || !value.inputBatchHandleId) {
		return '$noop'
	}
	return {
		activeImportTaskId: value.inputBatchHandleId,
		importProgress: {
			stage: 'queued',
			processed: 0,
			total: 0,
		},
		lastImportError: null,
	}
}

export const reduceSetImportProgress = (payload: unknown) => {
	const value = payload as ProjectSetImportProgressPayload | null
	const stage = value?.stage
	if (stage !== 'queued' && stage !== 'processing' && stage !== 'done' && stage !== 'error') {
		return '$noop'
	}
	const processed = typeof value?.processed === 'number' && Number.isFinite(value.processed)
		? Math.max(0, value.processed)
		: 0
	const total = typeof value?.total === 'number' && Number.isFinite(value.total)
		? Math.max(0, value.total)
		: 0
	const taskId = typeof value?.taskId === 'string' && value.taskId ? value.taskId : null
	const error = typeof value?.error === 'string' && value.error ? value.error : null

	return {
		activeImportTaskId: stage === 'done' || stage === 'error' ? null : taskId,
		importProgress: {
			stage,
			processed,
			total,
			...(error ? { error } : {}),
		},
		lastImportError: stage === 'error' ? error : null,
	}
}

export const reduceSetTracks = (payload: unknown) => {
	const tracks = (payload as { tracks?: unknown } | null)?.tracks
	return { tracks: Array.isArray(tracks) ? tracks : [] }
}

export const reduceSetResources = (payload: unknown) => {
	const resources = (payload as { resources?: unknown } | null)?.resources
	return { resources: Array.isArray(resources) ? resources : [] }
}

export const reduceAddVideoResourceToTimeline = (
	payload: unknown,
	noop: unknown,
	resources: unknown[],
	videoTrackAppendStart: unknown,
	audioTrackAppendStart: unknown,
) => {
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
}

export const reduceAddAudioResourceToTimeline = (
	payload: unknown,
	noop: unknown,
	resources: unknown[],
	audioTrackAppendStart: unknown,
) => {
	const sourceResourceId = (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId
	if (typeof sourceResourceId !== 'string') {
		return noop
	}
	const resource = findResourceBySourceId(Array.isArray(resources) ? resources : [], sourceResourceId)
	if (!resource || resource.kind !== 'audio') {
		return noop
	}
	return createTimelineClipPayload(noop, resource, {}, undefined, typeof audioTrackAppendStart === 'number' ? audioTrackAppendStart : 0)
}

export const reduceAddEmbeddedAudio = (
	payload: unknown,
	noop: unknown,
	resources: unknown[],
	audioTrackAppendStart: unknown,
	audioClipResourceIds?: unknown[],
) => {
	const sourceResourceId = (payload as { sourceResourceId?: unknown } | null)?.sourceResourceId
	if (typeof sourceResourceId !== 'string') {
		return noop
	}
	if (Array.isArray(audioClipResourceIds) && audioClipResourceIds.includes(sourceResourceId)) {
		return noop
	}
	const resource = findResourceBySourceId(Array.isArray(resources) ? resources : [], sourceResourceId)
	if (!resource) {
		return noop
	}
	return createEmbeddedAudioClipPayload(noop, resource, typeof audioTrackAppendStart === 'number' ? audioTrackAppendStart : 0)
}

export const reduceAddTextClipToVideoTrack = (payload: unknown) => payload
