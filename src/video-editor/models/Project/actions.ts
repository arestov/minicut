import type {
	ResourceByteRange,
	ResourceChunkMeta,
	ResourceDataState,
	ResourceDataStatus,
	ResourceChunkStatus,
	ResourceSourceKind,
	ResourceKind,
} from "../../domain/types";
import type {
	MiniCutDktResourceSeed,
	MiniCutDktTrackSeed,
} from "../../dkt/runtime/seedTypes";
import type { CrdtConflictLifecyclePayload } from "../../dkt/review/types";
import { makeCrdtResolvePayload } from "../../dkt/review/crdtReviewCommands";
import type {
	TrackOrderEntry,
	TrackOrderPreview,
} from "../../dkt/review/features/trackOrder";
import { defaultClipTransform } from "../Clip/actions";
import {
	reviewItemCreationFromItem,
	reviewSessionAttrsForProject,
} from "../ReviewSession/actions";
import { materializeCRDTConflictReviewItem } from "../../dkt/review/materializeCRDTConflictReviewItem";
import {
	REVIEW_TRACK_ROLES,
	makeReviewTrackAttrs,
	type ReviewTrackRole,
} from "../../dkt/review/reviewTrackPrimitives";

export type ProjectAddTrackPayload = MiniCutDktTrackSeed;
type ProjectTrackCreationInput = MiniCutDktTrackSeed & {
	isVisible?: boolean;
	trackRole?: "normal" | ReviewTrackRole;
	enabled?: boolean;
	visibleInPreview?: boolean;
};
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
export type ProjectMoveTrackWithinProjectPayload = {
	trackId?: unknown;
	afterTrackId?: unknown;
};
export type ProjectCreateReviewTrackPayload = {
	role?: unknown;
	kind?: unknown;
	name?: unknown;
};
export type ProjectResolveTrackOrderConflictPayload = {
	conflictId?: unknown;
	reviewItemId?: unknown;
	selectedOrder?: unknown;
	trackIds?: unknown;
	preview?: unknown;
};
export type DeleteVsEditVariantActionPayload = {
	conflictId?: unknown;
	reviewItemId?: unknown;
	clipId?: unknown;
	targetTrackId?: unknown;
	deletedVariant?: unknown;
	editedVariant?: unknown;
};

const asString = (value: unknown): string | null =>
	typeof value === "string" ? value : null;
const asNumber = (value: unknown): number | null =>
	typeof value === "number" ? value : null;
const asBoolean = (value: unknown): boolean | null =>
	typeof value === "boolean" ? value : null;
const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;

const asResourceKind = (value: unknown): ResourceKind =>
	value === "audio" || value === "image" || value === "text" || value === "video"
		? value
		: "video";

const asResourceSourceKind = (value: unknown): ResourceSourceKind =>
	value === "p2p" ? "p2p" : "local";

const asResourceDataStatus = (value: unknown): ResourceDataStatus =>
	value === "partial" || value === "ready" ? value : "missing";

const asResourceChunkStatus = (value: unknown): ResourceChunkStatus =>
	value === "loading" || value === "ready" ? value : "missing";

const asNonNegativeNumber = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;

const normalizeRange = (value: unknown): ResourceByteRange | null => {
	if (!Array.isArray(value) || value.length !== 2) {
		return null;
	}
	const start = asNonNegativeNumber(value[0], Number.NaN);
	const end = asNonNegativeNumber(value[1], Number.NaN);
	return Number.isFinite(start) && Number.isFinite(end) && end >= start
		? [start, end]
		: null;
};

const normalizeRanges = (value: unknown): ResourceByteRange[] =>
	Array.isArray(value)
		? value.flatMap((range) => {
				const normalized = normalizeRange(range);
				return normalized ? [normalized] : [];
			})
		: [];

const normalizeResourceData = (value: unknown): ResourceDataState | undefined => {
	const data = asObject<{
		status?: unknown;
		chunkSize?: unknown;
		chunks?: unknown;
		ranges?: { loaded?: unknown; requested?: unknown };
		loadedBytes?: unknown;
	}>(value);
	if (!data) {
		return undefined;
	}
	const chunks: Record<number, ResourceChunkMeta> = {};
	if (data.chunks && typeof data.chunks === "object") {
		for (const [rawIndex, rawChunk] of Object.entries(data.chunks)) {
			const chunk = asObject<{
				index?: unknown;
				start?: unknown;
				end?: unknown;
				size?: unknown;
				status?: unknown;
			}>(rawChunk);
			const index = Number(rawIndex);
			if (!chunk || !Number.isInteger(index) || index < 0) {
				continue;
			}
			chunks[index] = {
				index,
				start: asNonNegativeNumber(chunk.start),
				end: asNonNegativeNumber(chunk.end),
				size: asNonNegativeNumber(chunk.size),
				status: asResourceChunkStatus(chunk.status),
			};
		}
	}
	return {
		status: asResourceDataStatus(data.status),
		chunkSize: Math.max(1, asNonNegativeNumber(data.chunkSize, 1024 * 1024)),
		chunks,
		ranges: {
			loaded: normalizeRanges(data.ranges?.loaded),
			requested: normalizeRanges(data.ranges?.requested),
		},
		loadedBytes: asNonNegativeNumber(data.loadedBytes),
	};
};

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
	const value = payload as ProjectTrackCreationInput | null;
	return {
		kind: value?.kind === "audio" ? "audio" : "video",
		name: asString(value?.name) ?? "Track",
		muted: asBoolean(value?.muted) ?? false,
		locked: asBoolean(value?.locked) ?? false,
		isVisible: asBoolean(value?.isVisible) ?? true,
		height: asNumber(value?.height) ?? 84,
		trackRole:
			value?.trackRole === "incomingReview" ||
			value?.trackRole === "currentReview"
				? value.trackRole
				: "normal",
		enabled: asBoolean(value?.enabled) ?? true,
		visibleInPreview: asBoolean(value?.visibleInPreview) ?? true,
	};
};

export const normalizeResourceCreationAttrs = (payload: unknown) => {
	const value = payload as ProjectImportResourcePayload | null;
	return {
		name: asString(value?.name) ?? "Resource",
		kind: asResourceKind(value?.kind),
		url: asString(value?.url) ?? "",
		mime: asString(value?.mime) ?? "application/octet-stream",
		duration: asNumber(value?.duration) ?? 0,
		width: asNumber(value?.width),
		height: asNumber(value?.height),
		size: asNumber(value?.size),
		source: {
			kind: asResourceSourceKind(
				asObject<{ kind?: unknown }>(value?.source)?.kind,
			),
			...(typeof asObject<{ ownerPeerId?: unknown }>(value?.source)?.ownerPeerId ===
			"string"
				? {
						ownerPeerId: asObject<{ ownerPeerId?: string }>(value?.source)
							?.ownerPeerId,
					}
				: null),
		},
		status: asString(value?.status) ?? "missing",
		data: normalizeResourceData(value?.data),
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

const plainReviewValue = (value: unknown): unknown => {
	const nodeId = getNodeId(value);
	if (nodeId) {
		return nodeId;
	}
	if (Array.isArray(value)) {
		return value.map(plainReviewValue);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
				key,
				plainReviewValue(entry),
			]),
		);
	}
	return value;
};

const trackIdsFromModels = (tracks: unknown): string[] =>
	Array.isArray(tracks)
		? tracks.flatMap((track) => {
				const id = getNodeId(track);
				return id ? [id] : [];
			})
		: [];

const trackModelsForIds = (tracks: unknown, ids: readonly string[]): unknown[] | null => {
	if (!Array.isArray(tracks)) {
		return null;
	}
	const byId = new Map(
		tracks.flatMap((track) => {
			const id = getNodeId(track);
			return id ? [[id, track] as const] : [];
		}),
	);
	const models = ids.map((id) => byId.get(id));
	return models.every(Boolean) ? models : null;
};

const isUniqueStringList = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every((entry) => typeof entry === "string" && entry.length > 0) &&
	new Set(value).size === value.length;

const sameStringSet = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length && left.every((entry) => right.includes(entry));

const asTrackOrderPreview = (value: unknown): TrackOrderPreview | null => {
	const preview = asObject<TrackOrderPreview>(value);
	if (
		!preview ||
		preview.type !== "track_order" ||
		!Array.isArray(preview.currentOrder) ||
		!Array.isArray(preview.incomingOrder)
	) {
		return null;
	}
	return preview;
};

const trackEntriesForIds = (
	ids: readonly string[],
	preview: TrackOrderPreview,
): TrackOrderEntry[] => {
	const entries = new Map(
		[...preview.currentOrder, ...preview.incomingOrder].map((entry) => [
			entry.trackId,
			entry,
		]),
	);
	return ids.map(
		(trackId) =>
			entries.get(trackId) ?? {
				trackId,
				name: trackId,
				kind: "video",
			},
	);
};

const lifecycleRecords = (payload: unknown) => {
	const value = asObject<CrdtConflictLifecyclePayload>(payload);
	if (!value) {
		return [];
	}
	return [
		...(Array.isArray(value.opened) ? value.opened : []),
		...(Array.isArray(value.updated) ? value.updated : []),
		...(Array.isArray(value.acknowledged) ? value.acknowledged : []),
		...(Array.isArray(value.resolved) ? value.resolved : []),
	].filter((record) => asString(record?.conflict_id));
};

const reviewProjectIdHint = (payload: unknown): string | null => {
	const value = asObject<{ __reviewProjectIdHint?: unknown }>(payload);
	return asString(value?.__reviewProjectIdHint);
};

const projectOwnsConflictPayload = (
	payload: unknown,
	projectId: string,
): boolean => {
	const hint = reviewProjectIdHint(payload);
	if (!hint) {
		return false;
	}
	return hint === projectId;
};

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
	existingTracks?: unknown,
) => {
	if (autoCreateDefaultTracks !== true) {
		return null;
	}
	if (Array.isArray(existingTracks) && existingTracks.length > 0) {
		return null;
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
		$output: {
			rels: {
				videoTrack: { use_ref_id: "defaultVideoTrack" },
				audioTrack: { use_ref_id: "defaultAudioTrack" },
			},
		},
	};
};

export const reduceEnsureProjectReviewSession = (
	payload: unknown,
	noop: unknown,
	project: unknown,
	existingSession: unknown,
) => {
	const projectId = getNodeId(project);
	if (!projectId) {
		return noop;
	}
	if (lifecycleRecords(payload).length === 0) {
		return noop;
	}
	if (!projectOwnsConflictPayload(payload, projectId)) {
		return noop;
	}
	if (existingSession) {
		return noop;
	}
	return {
		reviewSession: {
			attrs: reviewSessionAttrsForProject(projectId),
			hold_ref_id: "projectReviewSession",
		},
		reviewSessions: { use_ref_id: "projectReviewSession" },
		$output: payload,
	};
};

export const reduceMaterializeProjectCRDTConflictReview = (
	payload: unknown,
	noop: unknown,
	project: unknown,
) => {
	const projectId = getNodeId(project);
	if (!projectId) {
		return noop;
	}
	if (!projectOwnsConflictPayload(payload, projectId)) {
		return noop;
	}
	const itemsById = new Map<
		string,
		ReturnType<typeof reviewItemCreationFromItem>
	>();
	for (const conflict of lifecycleRecords(payload)) {
		const item = materializeCRDTConflictReviewItem({ conflict, projectId });
		itemsById.delete(item.id);
		itemsById.set(item.id, reviewItemCreationFromItem(item));
	}
	const items = [...itemsById.values()];
	if (items.length === 0) {
		return noop;
	}
	const refs = items.map((item, index) => {
		const reviewItemId = item.attrs.reviewItemId;
		return typeof reviewItemId === "string"
			? `reviewItem:${reviewItemId}`
			: `reviewItem:${index}`;
	});
	const selectedReviewItemId = items[0]?.attrs.reviewItemId;
	return {
		reviewItem: items.map((item, index) => ({
			...item,
			hold_ref_id: refs[index],
		})),
		reviewItems: refs.map((ref) => ({ use_ref_id: ref })),
		sessionItems: refs.map((ref) => ({ use_ref_id: ref })),
		selectReviewItem:
			typeof selectedReviewItemId === "string"
				? { reviewItemId: selectedReviewItemId }
				: noop,
	};
};

export const reduceRenameProject = (payload: unknown) => {
	const title =
		typeof payload === "string"
			? payload
			: (payload as { title?: unknown } | null)?.title;
	return typeof title === "string" && title ? { title } : null;
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
		: null;
};

export const reduceSetProjectDuration = (payload: unknown) => {
	const duration =
		typeof payload === "number"
			? payload
			: (payload as { duration?: unknown } | null)?.duration;
	return typeof duration === "number"
		? { duration: Math.max(0, duration) }
		: null;
};

export const reduceAddTrack = (payload: unknown) => {
	const attrs = normalizeTrackCreationAttrs(payload);
	return {
		track: {
			attrs,
			hold_ref_id: "newTrack",
		},
		tracks: { use_ref_id: "newTrack" },
		$output: {
			rels: {
				track: { use_ref_id: "newTrack" },
			},
		},
	};
};

const asReviewTrackRole = (value: unknown): ReviewTrackRole | null =>
	value === "incomingReview" || value === "currentReview" ? value : null;

const getModelAttr = (model: unknown, key: string): unknown => {
	if (!model || typeof model !== "object") {
		return undefined;
	}
	const statesValue = (model as { states?: Record<string, unknown> }).states?.[
		key
	];
	return statesValue !== undefined
		? statesValue
		: (model as Record<string, unknown>)[key];
};

const nonEmptyString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const asAttrsRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const editedVariantFromPayload = (
	payload: unknown,
): Record<string, unknown> | null => {
	const value = asObject<DeleteVsEditVariantActionPayload>(payload);
	const variant = asObject<{ clipAttrs?: unknown; clip_attrs?: unknown }>(
		value?.editedVariant,
	);
	if (!variant) {
		return null;
	}
	return {
		...asAttrsRecord(variant.clip_attrs),
		...asAttrsRecord(variant.clipAttrs),
	};
};

const normalizeRestoredClipAttrs = (clipAttrs: Record<string, unknown>) => ({
	name: nonEmptyString(clipAttrs.name) ?? "Restored edited clip",
	color: nonEmptyString(clipAttrs.color) ?? "#f59e0b",
	mediaKind: nonEmptyString(clipAttrs.mediaKind) ?? "video",
	start: asNonNegativeNumber(clipAttrs.start),
	in: asNonNegativeNumber(clipAttrs.in),
	duration: Math.max(0.1, asNonNegativeNumber(clipAttrs.duration, 0.1)),
	fadeIn: asNonNegativeNumber(clipAttrs.fadeIn),
	fadeOut: asNonNegativeNumber(clipAttrs.fadeOut),
	audio: asObject(clipAttrs.audio) ?? { gain: 1, pan: 0 },
	opacity: asObject(clipAttrs.opacity) ?? { value: 1 },
	transform: asObject(clipAttrs.transform) ?? defaultClipTransform,
});

const existingReviewTrack = (
	tracks: unknown,
	role: ReviewTrackRole,
): unknown | null => {
	const currentTracks = Array.isArray(tracks) ? tracks : [];
	return (
		currentTracks.find((track) => getModelAttr(track, "trackRole") === role) ??
		null
	);
};

export const reduceResolveDeleteVsEditByRestoreVariant = (
	payload: unknown,
	noop: unknown,
	_project: unknown,
	targetTrack: unknown,
) => {
	const value = asObject<DeleteVsEditVariantActionPayload>(payload);
	const conflictId = nonEmptyString(value?.conflictId);
	const reviewItemId = nonEmptyString(value?.reviewItemId);
	const sourceConflictClipId =
		nonEmptyString(value?.clipId) ??
		nonEmptyString(
			asObject<{ clipId?: unknown }>(value?.deletedVariant)?.clipId,
		);
	const clipAttrs = editedVariantFromPayload(payload);
	const targetTrackId = nonEmptyString(value?.targetTrackId);
	if (
		!conflictId ||
		!reviewItemId ||
		!sourceConflictClipId ||
		!clipAttrs ||
		!targetTrack ||
		typeof targetTrack !== "object" ||
		getNodeId(targetTrack) !== targetTrackId
	) {
		return noop;
	}
	const restoredAttrs = normalizeRestoredClipAttrs(clipAttrs);
	return {
		clip: {
			attrs: restoredAttrs,
			rels: {
				resource: asObject(value?.editedVariant)?.resource ?? null,
			},
			hold_ref_id: "restoredDeleteVsEditClip",
		},
		next: {
			clip: { use_ref_id: "restoredDeleteVsEditClip" },
			targetTrack,
			conflictId,
			reviewItemId,
			sourceConflictClipId,
			targetTrackId,
			restoredAttrs,
		},
	};
};

export const reduceCommitDeleteVsEditRestoreVariant = (payload: unknown) => {
	const value = asObject<{
		clip?: unknown;
		rels?: { clip?: unknown; targetTrack?: unknown };
		targetTrack?: unknown;
		conflictId?: unknown;
		reviewItemId?: unknown;
		sourceConflictClipId?: unknown;
		targetTrackId?: unknown;
		restoredAttrs?: unknown;
	}>(payload);
	const clip = value?.clip ?? value?.rels?.clip;
	const targetTrack = value?.targetTrack ?? value?.rels?.targetTrack;
	const restoredClipId = getNodeId(clip);
	const targetTrackId =
		nonEmptyString(value?.targetTrackId) ?? getNodeId(targetTrack);
	const conflictId = nonEmptyString(value?.conflictId);
	const reviewItemId = nonEmptyString(value?.reviewItemId);
	const sourceConflictClipId = nonEmptyString(value?.sourceConflictClipId);
	return {
		targetTracks: {
			clip,
			targetTrack,
		},
		crdtResolve:
			restoredClipId &&
			targetTrackId &&
			conflictId &&
			reviewItemId &&
			sourceConflictClipId
				? makeCrdtResolvePayload({
						conflictId,
						reviewItemId,
						action: "resolveDeleteVsEditByRestoreVariant",
						domainResult: {
							type: "deleted_variant_restored",
							restoredClipId,
							targetTrackId,
							sourceConflictClipId,
							restoredAttrs: plainReviewValue(value?.restoredAttrs),
						},
					})
				: null,
	};
};

export const reduceParkEditedVariantOnReviewTrack = (
	payload: unknown,
	noop: unknown,
	project: unknown,
	tracks: unknown,
) => {
	const value = asObject<DeleteVsEditVariantActionPayload>(payload);
	const conflictId = nonEmptyString(value?.conflictId);
	const reviewItemId = nonEmptyString(value?.reviewItemId);
	const sourceConflictClipId =
		nonEmptyString(value?.clipId) ??
		nonEmptyString(
			asObject<{ clipId?: unknown }>(value?.deletedVariant)?.clipId,
		);
	const clipAttrs = editedVariantFromPayload(payload);
	if (!conflictId || !reviewItemId || !sourceConflictClipId || !clipAttrs) {
		return noop;
	}
	const restoredAttrs = normalizeRestoredClipAttrs(clipAttrs);
	const reviewTrack = existingReviewTrack(tracks, REVIEW_TRACK_ROLES.incoming);
	const trackRef = reviewTrack || { use_ref_id: "deleteVsEditReviewTrack" };
	const resourceRef = asObject(value?.editedVariant)?.resource;
	return {
		...(reviewTrack
			? null
			: {
					reviewTrack: {
						attrs: {
							...makeReviewTrackAttrs({
								role: REVIEW_TRACK_ROLES.incoming,
								kind:
									restoredAttrs.mediaKind === "audio" ? "audio" : "video",
							}),
							name: `Incoming Review - ${restoredAttrs.name}`,
						},
						rels: {
							project,
						},
						hold_ref_id: "deleteVsEditReviewTrack",
					},
					reviewTracks: { use_ref_id: "deleteVsEditReviewTrack" },
				}),
		parkedClip: {
			attrs: {
				...restoredAttrs,
				name: `${restoredAttrs.name} edited variant`,
			},
			rels: {
				resource: resourceRef ?? null,
			},
			hold_ref_id: "parkedDeleteVsEditClip",
		},
		next: {
			clip: { use_ref_id: "parkedDeleteVsEditClip" },
			targetTrack: trackRef,
			targetTrackRole: REVIEW_TRACK_ROLES.incoming,
			conflictId,
			reviewItemId,
			sourceConflictClipId,
		},
	};
};

export const reduceCommitParkEditedVariantOnReviewTrack = (payload: unknown) => {
	const value = asObject<{
		clip?: unknown;
		rels?: { clip?: unknown; targetTrack?: unknown };
		targetTrack?: unknown;
		conflictId?: unknown;
		reviewItemId?: unknown;
		sourceConflictClipId?: unknown;
	}>(payload);
	const clip = value?.clip ?? value?.rels?.clip;
	const targetTrack = value?.targetTrack ?? value?.rels?.targetTrack;
	const parkedClipId = getNodeId(clip);
	const reviewTrackId = getNodeId(targetTrack);
	const conflictId = nonEmptyString(value?.conflictId);
	const reviewItemId = nonEmptyString(value?.reviewItemId);
	const sourceConflictClipId = nonEmptyString(value?.sourceConflictClipId);
	return {
		targetTracks: {
			clip,
			targetTrack,
		},
		crdtResolve:
			parkedClipId &&
			reviewTrackId &&
			conflictId &&
			reviewItemId &&
			sourceConflictClipId
				? makeCrdtResolvePayload({
						conflictId,
						reviewItemId,
						action: "parkEditedVariantOnReviewTrack",
						domainResult: {
							type: "edited_variant_parked",
							parkedClipId,
							reviewTrackId,
							sourceConflictClipId,
						},
					})
				: null,
	};
};

export const reducePreserveDeleteAndArchiveIncomingEdit = (
	payload: unknown,
	noop: unknown,
	project: unknown,
) => {
	const value = asObject<DeleteVsEditVariantActionPayload>(payload);
	const conflictId = nonEmptyString(value?.conflictId);
	const reviewItemId = nonEmptyString(value?.reviewItemId);
	const sourceConflictClipId =
		nonEmptyString(value?.clipId) ??
		nonEmptyString(
			asObject<{ clipId?: unknown }>(value?.deletedVariant)?.clipId,
		);
	const editedVariant = asObject(value?.editedVariant);
	const projectId = getNodeId(project);
	if (
		!conflictId ||
		!reviewItemId ||
		!sourceConflictClipId ||
		!editedVariant ||
		!projectId
	) {
		return noop;
	}
	const archivedVariantId = `archive:${reviewItemId}:${sourceConflictClipId}`;
	return {
		reviewArchiveEntry: {
			attrs: {
				archiveEntryId: archivedVariantId,
				conflictId,
				reviewItemId,
				projectId,
				sourceConflictClipId,
				editedVariant,
			},
			hold_ref_id: "deleteVsEditArchiveEntry",
		},
		crdtResolve: makeCrdtResolvePayload({
			conflictId,
			reviewItemId,
			action: "preserveDeleteAndArchiveIncomingEdit",
			domainResult: {
				type: "delete_preserved_edit_archived",
				sourceConflictClipId,
				archivedVariantId,
			},
		}),
	};
};

export const reduceCreateReviewTrack = (payload: unknown) => {
	const value = payload as ProjectCreateReviewTrackPayload | null;
	const role = asReviewTrackRole(value?.role);
	if (!role) {
		return null;
	}
	const kind = value?.kind === "audio" ? "audio" : "video";
	const attrs = makeReviewTrackAttrs({ role, kind });
	return {
		track: {
			attrs: {
				...attrs,
				...(typeof value?.name === "string" && value.name
					? { name: value.name }
					: {}),
			},
			hold_ref_id: "newReviewTrack",
		},
		tracks: { use_ref_id: "newReviewTrack" },
		$output: {
			rels: {
				track: { use_ref_id: "newReviewTrack" },
			},
		},
	};
};

export const reduceEnsureReviewTrack = (
	payload: unknown,
	noop: unknown,
	tracks: unknown,
	role: ReviewTrackRole,
) => {
	const currentTracks = Array.isArray(tracks) ? tracks : [];
	if (
		currentTracks.some((track) => getModelAttr(track, "trackRole") === role)
	) {
		return noop;
	}
	return reduceCreateReviewTrack({
		...(payload && typeof payload === "object"
			? (payload as Record<string, unknown>)
			: {}),
		role,
	});
};

export const reduceSetProjectTrackPreviewEnabled = (payload: unknown) => {
	const value = payload as {
		trackId?: unknown;
		enabled?: unknown;
		value?: unknown;
	} | null;
	const trackId = value?.trackId;
	const enabled = value?.enabled ?? value?.value;
	if (typeof trackId !== "string" || typeof enabled !== "boolean") {
		return null;
	}
	return {
		[trackId]: {
			attrs: {
				enabled,
				visibleInPreview: enabled,
			},
		},
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

export const reduceImportResourceCreateOnly = (
	payload: unknown,
) => {
	const attrs = normalizeResourceCreationAttrs(payload);
	return {
		resource: {
			attrs,
			hold_ref_id: "newResource",
		},
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
		return null;
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
		return null;
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

export const reduceMoveTrackWithinProject = (
	payload: unknown,
	noop: unknown,
	tracks: unknown,
) => {
	const value = payload as ProjectMoveTrackWithinProjectPayload | null;
	const currentTracks = Array.isArray(tracks) ? tracks : [];
	const trackId = value?.trackId;
	const afterTrackId = value?.afterTrackId ?? null;
	const track =
		typeof trackId === "string"
			? currentTracks.find((item) => getNodeId(item) === trackId)
			: null;
	if (!track) {
		return noop;
	}
	return {
		tracks: {
			id: typeof afterTrackId === "string" ? afterTrackId : null,
			value: track,
		},
	};
};

export const reduceSetResources = (payload: unknown) => {
	const resources = (payload as { resources?: unknown } | null)?.resources;
	return { resources: Array.isArray(resources) ? resources : [] };
};

export const reduceResolveTrackOrderConflict = (
	payload: unknown,
	noop: unknown,
	currentTracks: unknown,
) => {
	const value = payload as ProjectResolveTrackOrderConflictPayload | null;
	const conflictId = asString(value?.conflictId);
	const reviewItemId = asString(value?.reviewItemId);
	const selectedOrder = value?.selectedOrder;
	const trackIds = value?.trackIds;
	const knownTrackIds = trackIdsFromModels(currentTracks);
	if (
		!conflictId ||
		!reviewItemId ||
		(selectedOrder !== "current" &&
			selectedOrder !== "incoming" &&
			selectedOrder !== "manual") ||
		!isUniqueStringList(trackIds) ||
		!sameStringSet(trackIds, knownTrackIds)
	) {
		return noop;
	}
	const orderedTracks = trackModelsForIds(currentTracks, trackIds);
	if (!orderedTracks) {
		return noop;
	}
	return {
		tracks: {
			id: null,
			value: orderedTracks,
		},
		crdtResolve: {
			conflict_id: conflictId,
			decision: {
				action: "resolveTrackOrderConflict",
				review_item_id: reviewItemId,
				domain_result: {
					type: "track_order_applied",
					selectedOrder,
					trackIds,
				},
			},
		},
	};
};

export const reducePreserveCurrentTrackOrder = (
	payload: unknown,
	noop: unknown,
	currentTracks: unknown,
) =>
	reduceResolveTrackOrderConflict(
		{
			...(payload && typeof payload === "object"
				? (payload as Record<string, unknown>)
				: {}),
			selectedOrder: "current",
		},
		noop,
		currentTracks,
	);

export const reduceCreateManualTrackOrderSuggestion = (
	payload: unknown,
	noop: unknown,
) => {
	const value = payload as ProjectResolveTrackOrderConflictPayload | null;
	const preview = asTrackOrderPreview(value?.preview);
	const trackIds = value?.trackIds;
	if (!preview || !isUniqueStringList(trackIds)) {
		return noop;
	}
	const knownTrackIds = preview.currentOrder.map((entry) => entry.trackId);
	if (!sameStringSet(trackIds, knownTrackIds)) {
		return noop;
	}
	return {
		preview: {
			...preview,
			manualOrder: trackEntriesForIds(trackIds, preview),
		},
	};
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
	project: unknown,
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
			rels: { track: targetTrack, resource: resolvedResource, project },
			hold_ref_id: "timelineClip",
		},
	};

	if (kind === "audio") {
		return { ...result, audioClips: { use_ref_id: "timelineClip" } };
	}

	if (kind !== "video") {
		return { ...result, videoClips: { use_ref_id: "timelineClip" } };
	}

	return {
		...result,
		audioClip: {
			attrs: createTimelineClipAttrs(
				resolvedResource,
				{ name: "Embedded audio", mediaKind: "audio" },
				start,
			),
			rels: { track: audioTrack, resource: resolvedResource, project },
			hold_ref_id: "timelineEmbeddedAudioClip",
		},
		videoClips: { use_ref_id: "timelineClip" },
		audioClips: { use_ref_id: "timelineEmbeddedAudioClip" },
	};
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

export const reduceAddTextClipToVideoTrack = (payload: unknown, project: unknown) => ({
	...((payload && typeof payload === "object") ? payload as Record<string, unknown> : {}),
	project,
});
