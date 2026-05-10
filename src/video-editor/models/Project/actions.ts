import type {
	MiniCutDktResourceSeed,
	MiniCutDktTrackSeed,
} from "../../dkt/runtime/seedTypes";
import { defaultClipTransform } from "../Clip/actions";

export type ProjectAddTrackPayload = MiniCutDktTrackSeed;
export type ProjectImportResourcePayload = MiniCutDktResourceSeed;
export type ProjectRequestImportFilesPayload = {
	inputBatchHandleId?: unknown;
};
export type ProjectSetImportProgressPayload = {
	taskId?: unknown;
	stage?: unknown;
	processed?: unknown;
	total?: unknown;
	error?: unknown;
};
export type ProjectMoveClipToTrackPayload = {
	clipId?: unknown;
	targetTrackId?: unknown;
	clip?: unknown;
	targetTrack?: unknown;
};

const asString = (value: unknown): string | null =>
	typeof value === "string" ? value : null;
const asNumber = (value: unknown): number | null =>
	typeof value === "number" ? value : null;
const asBoolean = (value: unknown): boolean | null =>
	typeof value === "boolean" ? value : null;
const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;

type ResourceLike = {
	_node_id?: unknown;
	states?: Record<string, unknown>;
	name?: unknown;
	kind?: unknown;
	url?: unknown;
	mime?: unknown;
	duration?: unknown;
};

export const normalizeTrackCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectAddTrackPayload | null;
	return {
		kind: value?.kind === "audio" ? "audio" : "video",
		name: asString(value?.name) ?? "Track",
		muted: asBoolean(value?.muted) ?? false,
		locked: asBoolean(value?.locked) ?? false,
		height: asNumber(value?.height) ?? 84,
	};
};

export const normalizeResourceCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectImportResourcePayload | null;
	return {
		name: asString(value?.name) ?? "Resource",
		kind: asString(value?.kind) ?? "video",
		url: asString(value?.url) ?? "",
		mime: asString(value?.mime) ?? "application/octet-stream",
		duration: asNumber(value?.duration) ?? 0,
		width: asNumber(value?.width),
		height: asNumber(value?.height),
		size: asNumber(value?.size),
		source: asObject(value?.source) ?? { kind: "local" },
		status: asString(value?.status) ?? "missing",
		data: asObject(value?.data),
	};
};

const asNumberFallback = (value: unknown, fallback: number): number =>
	typeof value === "number" ? value : fallback;

const getResourceAttr = (
	resource: ResourceLike,
	key: keyof Omit<ResourceLike, "_node_id" | "states">,
): unknown => {
	const stateValue = resource.states?.[key];
	if (stateValue !== undefined) {
		return stateValue;
	}
	return resource[key];
};

const getNodeId = (value: unknown): string | null =>
	value &&
	typeof value === "object" &&
	typeof (value as { _node_id?: unknown })._node_id === "string"
		? (value as { _node_id: string })._node_id
		: null;

export const getResourceKind = (resource: ResourceLike): string =>
	getResourceAttr(resource, "kind") === "audio" ||
	getResourceAttr(resource, "kind") === "image" ||
	getResourceAttr(resource, "kind") === "text"
		? (getResourceAttr(resource, "kind") as string)
		: "video";

export const createTimelineClipPayload = (
	noop: unknown,
	resource: ResourceLike,
	overrides: Partial<{
		name: string;
		mediaKind: string;
	}> = {},
	appendStart?: number,
) => {
	const resourceId = getNodeId(resource);
	if (!resourceId) {
		return noop;
	}

	return {
		resource,
		resourceId,
		name:
			overrides.name ??
			(typeof getResourceAttr(resource, "name") === "string"
				? (getResourceAttr(resource, "name") as string)
				: "Clip"),
		mediaKind: overrides.mediaKind ?? getResourceKind(resource),
		start: typeof appendStart === "number" ? appendStart : 0,
		in: 0,
		duration:
			typeof getResourceAttr(resource, "duration") === "number"
				? (getResourceAttr(resource, "duration") as number)
				: 0,
	};
};

const createTimelineClipAttrs = (
	resource: ResourceLike,
	overrides: Partial<{
		name: string;
		mediaKind: string;
	}> = {},
	appendStart?: number,
) => ({
	name:
		overrides.name ??
		(typeof getResourceAttr(resource, "name") === "string"
			? (getResourceAttr(resource, "name") as string)
			: "Clip"),
	color: "#2563eb",
	mediaKind: overrides.mediaKind ?? getResourceKind(resource),
	start: typeof appendStart === "number" ? appendStart : 0,
	in: 0,
	duration:
		typeof getResourceAttr(resource, "duration") === "number"
			? (getResourceAttr(resource, "duration") as number)
			: 0,
	fadeIn: 0,
	fadeOut: 0,
	audio: { gain: 1, pan: 0 },
	opacity: { value: 1 },
	transform: defaultClipTransform,
});

export const createEmbeddedAudioClipPayload = (
	noop: unknown,
	resource: ResourceLike,
	appendStart?: number,
) => {
	if (getResourceAttr(resource, "kind") !== "video") {
		return noop;
	}
	return createTimelineClipPayload(
		noop,
		resource,
		{
			name: "Embedded audio",
			mediaKind: "audio",
		},
		appendStart,
	);
};

export const reduceHandleInit = (
	_payload: unknown,
	autoCreateDefaultTracks: unknown,
) => {
	if (autoCreateDefaultTracks !== true) {
		return "$noop";
	}

	return {
		videoTrack: {
			attrs: {
				kind: "video",
				name: "V1",
				muted: false,
				locked: false,
				height: 72,
			},
			hold_ref_id: "defaultVideoTrack",
		},
		audioTrack: {
			attrs: {
				kind: "audio",
				name: "A1",
				muted: false,
				locked: false,
				height: 64,
			},
			hold_ref_id: "defaultAudioTrack",
		},
		tracks: [
			{ use_ref_id: "defaultVideoTrack" },
			{ use_ref_id: "defaultAudioTrack" },
		],
		primaryVideoTrack: { use_ref_id: "defaultVideoTrack" },
		primaryAudioTrack: { use_ref_id: "defaultAudioTrack" },
	};
};

export const reduceRenameProject = (payload: unknown) => {
	const title =
		typeof payload === "string"
			? payload
			: (payload as { title?: unknown } | null)?.title;
	return typeof title === "string" && title ? { title } : "$noop";
};

export const reduceSetProjectFormat = (payload: unknown) => {
	const value = payload as {
		fps?: unknown;
		width?: unknown;
		height?: unknown;
	} | null;
	return value && typeof value === "object"
		? {
				fps: asNumberFallback(value.fps, 30),
				width: asNumberFallback(value.width, 1920),
				height: asNumberFallback(value.height, 1080),
			}
		: "$noop";
};

export const reduceSetProjectDuration = (payload: unknown) => {
	const duration =
		typeof payload === "number"
			? payload
			: (payload as { duration?: unknown } | null)?.duration;
	return typeof duration === "number"
		? { duration: Math.max(0, duration) }
		: "$noop";
};

export const reduceAddTrack = (payload: unknown) => {
	const attrs = normalizeTrackCreationAttrs(payload);
	return {
		track: { attrs, hold_ref_id: "newTrack" },
		tracks: { use_ref_id: "newTrack" },
	};
};

export const reduceImportResourceCreate = (
	payload: unknown,
	clips: unknown[],
) => {
	const attrs = normalizeResourceCreationAttrs(payload);
	const hasTimelineClips =
		Array.isArray(clips) &&
		clips.some((entry) => {
			if (Array.isArray(entry)) {
				return entry.length > 0;
			}
			return Boolean(entry);
		});
	const shouldAddToTimeline = !hasTimelineClips;

	return {
		resource: { attrs, hold_ref_id: "newResource" },
		resources: { use_ref_id: "newResource" },
		$output: {
			rels: {
				resource: { use_ref_id: "newResource" },
			},
			shouldAddToTimeline,
			shouldAddEmbeddedAudio: shouldAddToTimeline && attrs.kind === "video",
		},
	};
};

export const reduceImportResourceCreateOnly = (payload: unknown) => {
	const attrs = normalizeResourceCreationAttrs(payload);
	return {
		resource: { attrs, hold_ref_id: "newResource" },
		resources: { use_ref_id: "newResource" },
	};
};

export const reduceImportResource = (
	payload: unknown,
	_noop: unknown,
	clips: unknown[],
	videoTrack: unknown,
	audioTrack: unknown,
	videoTrackAppendStart: unknown,
	audioTrackAppendStart: unknown,
) => {
	const attrs = normalizeResourceCreationAttrs(payload);
	const hasTimelineClips =
		Array.isArray(clips) &&
		clips.some((entry) => {
			if (Array.isArray(entry)) {
				return entry.length > 0;
			}
			return Boolean(entry);
		});
	const shouldAddToTimeline = !hasTimelineClips;
	const kind = getResourceKind(attrs);
	const result: Record<string, unknown> = {
		resource: { attrs, hold_ref_id: "newResource" },
		resources: { use_ref_id: "newResource" },
	};

	if (!shouldAddToTimeline) {
		return result;
	}

	if (kind !== "audio" && videoTrack && typeof videoTrack === "object") {
		result.videoClip = {
			attrs: createTimelineClipAttrs(
				attrs,
				{},
				typeof videoTrackAppendStart === "number" ? videoTrackAppendStart : 0,
			),
			rels: { track: videoTrack, resource: { use_ref_id: "newResource" } },
			hold_ref_id: "importVideoClip",
		};
		result.videoClips = { use_ref_id: "importVideoClip" };
	}

	if (
		(kind === "audio" || kind === "video") &&
		audioTrack &&
		typeof audioTrack === "object"
	) {
		result.audioClip = {
			attrs: createTimelineClipAttrs(
				attrs,
				kind === "video" ? { name: "Embedded audio", mediaKind: "audio" } : {},
				typeof audioTrackAppendStart === "number" ? audioTrackAppendStart : 0,
			),
			rels: { track: audioTrack, resource: { use_ref_id: "newResource" } },
			hold_ref_id: "importAudioClip",
		};
		result.audioClips = { use_ref_id: "importAudioClip" };
	}

	return result;
};

const resolveOutputResource = (payload: unknown): ResourceLike | null => {
	const value = payload as {
		resource?: unknown;
		rels?: { resource?: unknown };
	} | null;
	const resource = value?.rels?.resource ?? value?.resource;
	if (resource && typeof resource === "object") {
		return resource as ResourceLike;
	}
	return null;
};

export const reduceImportResourceToVideo = (
	payload: unknown,
	noop: unknown,
	_resources: unknown[],
	appendStart: unknown,
) => {
	const value = payload as { shouldAddToTimeline?: unknown } | null;
	if (value?.shouldAddToTimeline !== true) {
		return noop;
	}
	const resource = resolveOutputResource(payload);
	if (!resource || getResourceKind(resource) === "audio") {
		return noop;
	}
	return createTimelineClipPayload(
		noop,
		resource,
		{},
		typeof appendStart === "number" ? appendStart : 0,
	);
};

export const reduceImportResourceToAudio = (
	payload: unknown,
	noop: unknown,
	_resources: unknown[],
	appendStart: unknown,
) => {
	const value = payload as { shouldAddToTimeline?: unknown } | null;
	if (value?.shouldAddToTimeline !== true) {
		return noop;
	}
	const resource = resolveOutputResource(payload);
	if (!resource || getResourceKind(resource) !== "audio") {
		return noop;
	}
	return createTimelineClipPayload(
		noop,
		resource,
		{},
		typeof appendStart === "number" ? appendStart : 0,
	);
};

export const reduceImportResourceToEmbeddedAudio = (
	payload: unknown,
	noop: unknown,
	_resources: unknown[],
	audioTrackAppendStart: unknown,
) => {
	const value = payload as { shouldAddEmbeddedAudio?: unknown } | null;
	if (value?.shouldAddEmbeddedAudio !== true) {
		return noop;
	}
	const resource = resolveOutputResource(payload);
	if (!resource) {
		return noop;
	}
	return createEmbeddedAudioClipPayload(
		noop,
		resource,
		typeof audioTrackAppendStart === "number" ? audioTrackAppendStart : 0,
	);
};

const createTimelineClipTargetResult = (
	noop: unknown,
	resource: ResourceLike,
	track: unknown,
	holdRefId: string,
	appendStart: unknown,
	overrides: Partial<{
		name: string;
		mediaKind: string;
	}> = {},
) => {
	if (!track || typeof track !== "object" || !getNodeId(resource)) {
		return noop;
	}
	return {
		clip: {
			attrs: createTimelineClipAttrs(
				resource,
				overrides,
				typeof appendStart === "number" ? appendStart : 0,
			),
			rels: { track, resource },
			hold_ref_id: holdRefId,
		},
		clips: { use_ref_id: holdRefId },
	};
};

export const reduceImportResourceToEmbeddedAudioTarget = (
	payload: unknown,
	noop: unknown,
	audioTrack: unknown,
	audioTrackAppendStart: unknown,
) => {
	const value = payload as { shouldAddEmbeddedAudio?: unknown } | null;
	if (value?.shouldAddEmbeddedAudio !== true) {
		return noop;
	}
	const resource = resolveOutputResource(payload);
	if (!resource || getResourceKind(resource) !== "video") {
		return noop;
	}
	return createTimelineClipTargetResult(
		noop,
		resource,
		audioTrack,
		"importEmbeddedAudioClip",
		audioTrackAppendStart,
		{
			name: "Embedded audio",
			mediaKind: "audio",
		},
	);
};

export const reduceImportResourceToVideoTarget = (
	payload: unknown,
	noop: unknown,
	videoTrack: unknown,
	videoTrackAppendStart: unknown,
) => {
	const value = payload as { shouldAddToTimeline?: unknown } | null;
	if (value?.shouldAddToTimeline !== true) {
		return noop;
	}
	const resource = resolveOutputResource(payload);
	if (!resource || getResourceKind(resource) === "audio") {
		return noop;
	}
	return createTimelineClipTargetResult(
		noop,
		resource,
		videoTrack,
		"importVideoClip",
		videoTrackAppendStart,
	);
};

export const reduceImportResourceToAudioTarget = (
	payload: unknown,
	noop: unknown,
	audioTrack: unknown,
	audioTrackAppendStart: unknown,
) => {
	const value = payload as { shouldAddToTimeline?: unknown } | null;
	if (value?.shouldAddToTimeline !== true) {
		return noop;
	}
	const resource = resolveOutputResource(payload);
	if (!resource || getResourceKind(resource) !== "audio") {
		return noop;
	}
	return createTimelineClipTargetResult(
		noop,
		resource,
		audioTrack,
		"importAudioClip",
		audioTrackAppendStart,
	);
};

export const reduceRequestImportFiles = (payload: unknown) => {
	const value = payload as ProjectRequestImportFilesPayload | null;
	if (
		typeof value?.inputBatchHandleId !== "string" ||
		!value.inputBatchHandleId
	) {
		return "$noop";
	}
	return {
		activeImportTaskId: value.inputBatchHandleId,
		importProgress: {
			stage: "queued",
			processed: 0,
			total: 0,
		},
		lastImportError: null,
	};
};

export const reduceSetImportProgress = (payload: unknown) => {
	const value = payload as ProjectSetImportProgressPayload | null;
	const stage = value?.stage;
	if (
		stage !== "queued" &&
		stage !== "processing" &&
		stage !== "done" &&
		stage !== "error"
	) {
		return "$noop";
	}
	const processed =
		typeof value?.processed === "number" && Number.isFinite(value.processed)
			? Math.max(0, value.processed)
			: 0;
	const total =
		typeof value?.total === "number" && Number.isFinite(value.total)
			? Math.max(0, value.total)
			: 0;
	const taskId =
		typeof value?.taskId === "string" && value.taskId ? value.taskId : null;
	const error =
		typeof value?.error === "string" && value.error ? value.error : null;

	return {
		activeImportTaskId: stage === "done" || stage === "error" ? null : taskId,
		importProgress: {
			stage,
			processed,
			total,
			...(error ? { error } : {}),
		},
		lastImportError: stage === "error" ? error : null,
	};
};

export const reduceSetTracks = (payload: unknown) => {
	const tracks = (payload as { tracks?: unknown } | null)?.tracks;
	return { tracks: Array.isArray(tracks) ? tracks : [] };
};

export const reduceSetResources = (payload: unknown) => {
	const resources = (payload as { resources?: unknown } | null)?.resources;
	return { resources: Array.isArray(resources) ? resources : [] };
};

export const reduceMoveClipToTrackContext = (
	payload: unknown,
	noop: unknown,
	resolvedClip: unknown,
	resolvedTargetTrack: unknown,
) => {
	const value = payload as ProjectMoveClipToTrackPayload | null;
	const clip =
		resolvedClip && typeof resolvedClip === "object"
			? resolvedClip
			: value?.clip;
	const targetTrack =
		resolvedTargetTrack && typeof resolvedTargetTrack === "object"
			? resolvedTargetTrack
			: value?.targetTrack;
	const clipId = getNodeId(clip);
	if (
		!clip ||
		typeof clip !== "object" ||
		!targetTrack ||
		typeof targetTrack !== "object" ||
		!clipId
	) {
		return noop;
	}

	return {
		clip: {
			[clipId]: { rels: { track: targetTrack } },
		},
		tracks: { clip },
		$output: { clip, targetTrack },
	};
};

export const reduceMoveClipToTrackPayload = (payload: unknown) => payload;

export const reduceAddResourceToTimeline = (
	_payload: unknown,
	noop: unknown,
	resource: unknown,
	videoTrack: unknown,
	audioTrack: unknown,
	videoTrackAppendStart: unknown,
	audioTrackAppendStart: unknown,
) => {
	if (!resource || typeof resource !== "object") {
		return noop;
	}
	const resolvedResource = resource as ResourceLike;
	const kind = getResourceKind(resolvedResource);
	const targetTrack = kind === "audio" ? audioTrack : videoTrack;
	const start =
		kind === "audio"
			? typeof audioTrackAppendStart === "number"
				? audioTrackAppendStart
				: 0
			: Math.max(
					typeof videoTrackAppendStart === "number" ? videoTrackAppendStart : 0,
					typeof audioTrackAppendStart === "number" ? audioTrackAppendStart : 0,
				);
	if (!getNodeId(resolvedResource)) {
		return noop;
	}
	const result = {
		clip: {
			attrs: createTimelineClipAttrs(resolvedResource, {}, start),
			rels: { track: targetTrack, resource: resolvedResource },
			hold_ref_id: "timelineClip",
		},
	};

	return kind === "audio"
		? { ...result, audioClips: { use_ref_id: "timelineClip" } }
		: { ...result, videoClips: { use_ref_id: "timelineClip" } };
};

export const reduceAddEmbeddedAudio = (
	payload: unknown,
	noop: unknown,
	resource: unknown,
	audioTrackAppendStart: unknown,
	audioClipResourceIds?: unknown[],
) => {
	const resourceId =
		typeof payload === "string"
			? payload
			: (payload as { resourceId?: unknown } | null)?.resourceId;
	if (typeof resourceId !== "string") {
		return noop;
	}
	if (
		Array.isArray(audioClipResourceIds) &&
		audioClipResourceIds.includes(resourceId)
	) {
		return noop;
	}
	if (!resource || typeof resource !== "object") {
		return noop;
	}
	return createEmbeddedAudioClipPayload(
		noop,
		resource as ResourceLike,
		typeof audioTrackAppendStart === "number" ? audioTrackAppendStart : 0,
	);
};

export const reduceAddTextClipToVideoTrack = (payload: unknown) => payload;
