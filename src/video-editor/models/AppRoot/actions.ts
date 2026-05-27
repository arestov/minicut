import { makeCrdtAcknowledgePayload } from "../../dkt/review/crdtReviewCommands";
import {
	readDanglingRefConflict,
	readMvrAttrConflict,
	readSequenceMoveConflict,
	readStructuralDeleteRelationConflict,
} from "../../dkt/review/dktConflictNormalizers";
import { withMiniCutConflictDetails } from "../../dkt/review/minicutConflictEnrichment";
import type { CrdtConflictRecord } from "../../dkt/review/types";
import { defaultClipTransform } from "../Clip/actions";
import { reduceCreateActivitySummary } from "../ActivitySummary/actions";
import { reduceCreateReviewItem } from "../ReviewItem/actions";
import {
	reduceCreateReviewSession,
	reduceCreateReviewSessionWithActivitySummary,
	reduceCreateReviewSessionWithLifecycleItems,
} from "../ReviewSession/actions";
import { defaultTextBox, defaultTextStyle } from "../Text/defaults";
import { numberOr, numberOrNull, objectOr, stringOr } from "../valueGuards";

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;

const getNodeId = (model: unknown): string | null =>
	model &&
	typeof model === "object" &&
	typeof (model as { _node_id?: unknown })._node_id === "string"
		? (model as { _node_id: string })._node_id
		: null;

const relList = (model: unknown, relName: string): unknown[] => {
	if (!model || typeof model !== "object") {
		return [];
	}
	const rels = (model as { children_models?: Record<string, unknown> })
		.children_models;
	const value = rels?.[relName];
	return Array.isArray(value) ? value : value ? [value] : [];
};

const collectConflictNodeIds = (payload: unknown): Set<string> => {
	const ids = new Set<string>();
	const collectRecordIds = (value: unknown) => {
		if (!value || typeof value !== "object") {
			return;
		}
		const record = value as Record<string, unknown>;
		const structural = readStructuralDeleteRelationConflict(
			record as unknown as CrdtConflictRecord,
		);
		if (structural) {
			ids.add(structural.ownerNodeId);
			ids.add(structural.itemNodeId);
		}
		const dangling = readDanglingRefConflict(
			record as unknown as CrdtConflictRecord,
		);
		if (dangling) {
			ids.add(dangling.sourceNodeId);
			ids.add(dangling.targetNodeId);
		}
		for (const key of ["node_id"]) {
			const id = record[key];
			if (typeof id === "string" && id.length > 0) {
				ids.add(id);
			}
		}
		for (const key of ["payload", "details", "variants"]) {
			collectRecordIds(record[key]);
		}
	};
	if (!payload || typeof payload !== "object") {
		return ids;
	}
	const value = payload as {
		opened?: unknown;
		updated?: unknown;
		acknowledged?: unknown;
		resolved?: unknown;
	};
	for (const list of [
		value.opened,
		value.updated,
		value.acknowledged,
		value.resolved,
	]) {
		if (!Array.isArray(list)) {
			continue;
		}
		for (const item of list) {
			collectRecordIds(item);
		}
	}
	return ids;
};

const findProjectIdForConflictPayload = (
	payload: unknown,
	projects: unknown,
): string | null => {
	const conflictNodeIds = collectConflictNodeIds(payload);
	if (conflictNodeIds.size === 0 || !Array.isArray(projects)) {
		return null;
	}
	for (const project of projects) {
		const projectId = getNodeId(project);
		if (projectId && conflictNodeIds.has(projectId)) {
			return projectId;
		}
		for (const resource of relList(project, "resources")) {
			const resourceId = getNodeId(resource);
			if (resourceId && conflictNodeIds.has(resourceId)) {
				return projectId;
			}
		}
		for (const track of relList(project, "tracks")) {
			for (const clip of relList(track, "clips")) {
				const clipId = getNodeId(clip);
				if (clipId && conflictNodeIds.has(clipId)) {
					return projectId;
				}
			}
		}
	}
	return null;
};

export const resolveReviewProjectIdHint = (
	payload: unknown,
	rootProjectId: unknown,
	projects?: unknown,
): unknown =>
	findProjectIdForConflictPayload(payload, projects) ??
	rootProjectId;

const resolveOutputRelModel = (payload: unknown, relName: string): unknown => {
	const rels = asRecord((payload as { rels?: unknown } | null)?.rels);
	return rels?.[relName] ?? null;
};

export const reduceCreateProjectModel = (payload: unknown) => {
	const value = payload as {
		title?: unknown;
		fps?: unknown;
		width?: unknown;
		height?: unknown;
		duration?: unknown;
		createdAt?: unknown;
		updatedAt?: unknown;
		tracks?: unknown;
		autoCreateDefaultTracks?: unknown;
	} | null;

	const tracks = Array.isArray(value?.tracks)
		? value.tracks
				.map((track) => {
					const item = track as {
						kind?: unknown;
						name?: unknown;
						muted?: unknown;
						locked?: unknown;
						height?: unknown;
					} | null;
					if (!item || typeof item !== "object") {
						return null;
					}
					return {
						attrs: {
							kind: item.kind === "audio" ? "audio" : "video",
							name: stringOr(item.name, "Track"),
							muted: item.muted === true,
							locked: item.locked === true,
							height: numberOr(item.height, 84),
						},
					};
				})
				.filter(
					(
						track,
					): track is {
						attrs: {
							kind: "audio" | "video";
							name: string;
							muted: boolean;
							locked: boolean;
							height: number;
						};
					} => Boolean(track),
				)
		: [];

	return {
		attrs: {
			title: stringOr(value?.title, "Untitled project"),
			fps: numberOr(value?.fps, 30),
			width: numberOr(value?.width, 1920),
			height: numberOr(value?.height, 1080),
			duration: numberOr(value?.duration, 0),
			createdAt: numberOr(value?.createdAt, 0),
			updatedAt: numberOr(value?.updatedAt, 0),
			autoCreateDefaultTracks: value?.autoCreateDefaultTracks === true,
		},
		rels: tracks.length > 0 ? { tracks } : undefined,
	};
};

export const reduceCreateTrackModel = (payload: unknown) => {
	const value = payload as {
		kind?: unknown;
		name?: unknown;
		muted?: unknown;
		locked?: unknown;
		height?: unknown;
	} | null;
	return {
		attrs: {
			kind: value?.kind === "audio" ? "audio" : "video",
			name: stringOr(value?.name, "Track"),
			muted: value?.muted === true,
			locked: value?.locked === true,
			height: numberOr(value?.height, 84),
		},
	};
};

export const reduceCreateResourceModel = (payload: unknown) => {
	const value = payload as {
		name?: unknown;
		kind?: unknown;
		url?: unknown;
		mime?: unknown;
		duration?: unknown;
		width?: unknown;
		height?: unknown;
		size?: unknown;
		source?: unknown;
		status?: unknown;
		data?: unknown;
	} | null;

	return {
		attrs: {
			name: stringOr(value?.name, "Resource"),
			kind: stringOr(value?.kind, "video"),
			url: stringOr(value?.url, ""),
			mime: stringOr(value?.mime, "application/octet-stream"),
			duration: numberOr(value?.duration, 0),
			width: numberOrNull(value?.width),
			height: numberOrNull(value?.height),
			size: numberOrNull(value?.size),
			source: objectOr(value?.source, { kind: "local" }),
			status: stringOr(value?.status, "missing"),
			data: objectOr(value?.data, null),
		},
	};
};

export const reduceCreateTextModel = (payload: unknown) => {
	const value = payload as {
		content?: unknown;
		style?: unknown;
		box?: unknown;
	} | null;
	return {
		attrs: {
			content: stringOr(value?.content, "Text"),
			style: objectOr(value?.style, defaultTextStyle),
			box: objectOr(value?.box, defaultTextBox),
		},
	};
};

export const reduceCreateEffectModel = (payload: unknown) => {
	const value = payload as {
		name?: unknown;
		kind?: unknown;
		enabled?: unknown;
		amount?: unknown;
		params?: unknown;
		color?: unknown;
	} | null;
	return {
		attrs: {
			name: stringOr(value?.name, "Effect"),
			kind: stringOr(value?.kind, "blur"),
			enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
			amount: numberOrNull(value?.amount),
			params: objectOr(value?.params, null),
			color: objectOr(value?.color, null),
		},
	};
};

export const reduceCreateClipModel = (payload: unknown) => {
	const value = payload as {
		name?: unknown;
		color?: unknown;
		mediaKind?: unknown;
		start?: unknown;
		in?: unknown;
		duration?: unknown;
		fadeIn?: unknown;
		fadeOut?: unknown;
		audio?: unknown;
		opacity?: unknown;
		transform?: unknown;
	} | null;

	return {
		attrs: {
			name: stringOr(value?.name, "Clip"),
			color: stringOr(value?.color, "#2563eb"),
			mediaKind: stringOr(value?.mediaKind, "") || null,
			start: numberOr(value?.start, 0),
			in: numberOr(value?.in, 0),
			duration: numberOr(value?.duration, 0),
			fadeIn: numberOr(value?.fadeIn, 0),
			fadeOut: numberOr(value?.fadeOut, 0),
			audio: objectOr(value?.audio, { gain: 1, pan: 0 }),
			opacity: objectOr(value?.opacity, { value: 1 }),
			transform: objectOr(value?.transform, defaultClipTransform),
		},
	};
};

export const reduceCreateReviewItemModel = (payload: unknown) =>
	reduceCreateReviewItem(payload);

export const reduceCreateReviewSessionModel = (
	payload: unknown,
	projectIdHint?: unknown,
) => reduceCreateReviewSession(payload, projectIdHint);

export const reduceCreateActivitySummaryModel = (payload: unknown) =>
	reduceCreateActivitySummary(payload);

export const reduceHandleCRDTConflict = (
	payload: unknown,
	projectIdHint?: unknown,
	projects?: unknown,
	clips?: unknown,
) =>
	reduceCreateReviewSessionWithLifecycleItems(
		augmentReviewConflictPayload(payload, projects, clips),
		projectIdHint,
	);

export const reduceHandleCRDTSync = (
	payload: unknown,
	projectIdHint?: unknown,
) => reduceCreateReviewSessionWithActivitySummary(payload, projectIdHint);

const trackOrderMove = (value: unknown) => {
	const record = asRecord(value);
	const itemId = stringOr(record?.item_id ?? record?.itemId, "");
	return itemId
		? {
				itemId,
				afterId: stringOr(record?.after_id ?? record?.afterId, "") || null,
			}
		: null;
};

const trackOrderEntryFromModel = (track: unknown) => {
	const trackId = getNodeId(track);
	if (!trackId) return null;
	const states = asRecord((track as { states?: unknown } | null)?.states) ?? {};
	const name = stringOr(states.name, trackId);
	const kind = stringOr(states.kind, "video") === "audio" ? "audio" : "video";
	return { trackId, name, kind };
};

const applyTrackOrderMove = <Track extends { trackId: string }>(
	baseOrder: Track[],
	itemId: string,
	afterId: string | null,
) => {
	const movingTrack = baseOrder.find((track) => track.trackId === itemId);
	if (!movingTrack) return baseOrder;
	const nextOrder = baseOrder.filter((track) => track.trackId !== itemId);
	if (afterId === null) return [movingTrack, ...nextOrder];
	const anchorIndex = nextOrder.findIndex((track) => track.trackId === afterId);
	nextOrder.splice(anchorIndex >= 0 ? anchorIndex + 1 : nextOrder.length, 0, movingTrack);
	return nextOrder;
};

const augmentTrackOrderConflict = (payload: unknown, projects: unknown) => {
	const conflict = asRecord(payload);
	if (
		!conflict ||
		conflict.kind !== "sequence_move_vs_move" ||
		conflict.field_name !== "tracks" ||
		conflict.aggregate !== "projectTracks"
	) {
		return payload;
	}
	const sequence = readSequenceMoveConflict(
		conflict as unknown as CrdtConflictRecord,
	);
	const current = trackOrderMove(sequence?.current);
	const incoming = trackOrderMove(sequence?.incoming);
	const itemId = incoming?.itemId ?? current?.itemId ?? sequence?.itemNodeId;
	if (!current || !incoming || !itemId || current.itemId !== itemId) {
		return payload;
	}
	const project = Array.isArray(projects)
		? projects.find((candidate) => getNodeId(candidate) === conflict.node_id)
		: null;
	const trackOrder = relList(project, "tracks")
		.map(trackOrderEntryFromModel)
		.filter((track): track is NonNullable<typeof track> => Boolean(track));
	if (trackOrder.length === 0) {
		return payload;
	}
	const currentOrder = applyTrackOrderMove(
		trackOrder,
		itemId,
		current.afterId,
	).map((track) => track.trackId);
	const incomingOrder = applyTrackOrderMove(
		trackOrder,
		itemId,
		incoming.afterId,
	).map((track) => track.trackId);
	return withMiniCutConflictDetails(conflict, {
		trackOrder: {
			tracks: trackOrder,
			currentOrder,
			incomingOrder,
		},
	});
};

const modelStates = (model: unknown): Record<string, unknown> =>
	asRecord((model as { states?: unknown } | null)?.states) ?? {};

const clipSnapshotAttrs = (clip: unknown): Record<string, unknown> => {
	const states = modelStates(clip);
	return {
		name: stringOr(states.name, "Restored clip"),
		color: stringOr(states.color, "#2563eb"),
		mediaKind: stringOr(states.mediaKind, "video"),
		start: numberOr(states.start, 0),
		in: numberOr(states.in, 0),
		duration: numberOr(states.duration, 0),
		fadeIn: numberOr(states.fadeIn, 0),
		fadeOut: numberOr(states.fadeOut, 0),
		audio: objectOr(states.audio, { gain: 1, pan: 0 }),
		opacity: objectOr(states.opacity, { value: 1 }),
		transform: objectOr(states.transform, defaultClipTransform),
	};
};

const clipSnapshotTiming = (clip: unknown): Record<string, unknown> => {
	const states = modelStates(clip);
	return {
		start: numberOr(states.start, 0),
		in: numberOr(states.in, 0),
		duration: numberOr(states.duration, 1),
		fadeIn: numberOr(states.fadeIn, 0),
		fadeOut: numberOr(states.fadeOut, 0),
	};
};

const mvrAlternativeValue = (value: unknown): unknown =>
	asRecord(value)?.value ?? value;

const findTrackProjectId = (projects: unknown, trackId: string): string | null => {
	if (!Array.isArray(projects)) return null;
	for (const project of projects) {
		if (relList(project, "tracks").some((track) => getNodeId(track) === trackId)) {
			return getNodeId(project);
		}
	}
	return null;
};

const findClipInProjects = (projects: unknown, clipId: string): unknown => {
	if (!Array.isArray(projects)) return null;
	for (const project of projects) {
		for (const track of relList(project, "tracks")) {
			const clip = relList(track, "clips").find(
				(candidate) => getNodeId(candidate) === clipId,
			);
			if (clip) return clip;
		}
	}
	return null;
};

const augmentDeleteVsEditConflict = (
	payload: unknown,
	projects: unknown,
	clips: unknown,
) => {
	const conflict = asRecord(payload);
	if (
		!conflict ||
		!(
			conflict.kind === "structural_delete_vs_edit" ||
			conflict.kind === "structural_delete_with_concurrent_activity"
		)
	) {
		return payload;
	}
	const structural = readStructuralDeleteRelationConflict(
		conflict as unknown as CrdtConflictRecord,
	);
	if (!structural || structural.relationName !== "clips") {
		return payload;
	}
	const clip = Array.isArray(clips)
		? clips.find((candidate) => getNodeId(candidate) === structural.itemNodeId)
		: null;
	const projectId = findTrackProjectId(projects, structural.ownerNodeId);
	const deleteVsEdit = {
		deleted: {
			clipId: structural.itemNodeId,
			trackId: structural.ownerNodeId,
		},
		edited: {
			clipAttrs: {
				...(clip ? clipSnapshotAttrs(clip) : {}),
				clipId: structural.itemNodeId,
				targetTrackId: structural.ownerNodeId,
			},
		},
	};
	return {
		...withMiniCutConflictDetails(conflict, { deleteVsEdit }),
		...(projectId ? { project_id: projectId } : null),
	};
};

const augmentDanglingResourceConflict = (payload: unknown) => {
	const conflict = asRecord(payload);
	if (!conflict || conflict.kind !== "dangling_ref") {
		return payload;
	}
	const danglingRef = readDanglingRefConflict(
		conflict as unknown as CrdtConflictRecord,
	);
	if (!danglingRef || danglingRef.fieldName !== "resource") {
		return payload;
	}
	return withMiniCutConflictDetails(conflict, {
		danglingResource: {
			resourceId: danglingRef.targetNodeId,
			resourceName: "Missing media",
			resourceKind: "media",
			clipIds: [danglingRef.sourceNodeId],
			missingUrl: null,
			lastKnownSource: null,
		},
	});
};

const augmentClipTimingConflict = (
	payload: unknown,
	projects: unknown,
	clips: unknown,
) => {
	const conflict = asRecord(payload);
	if (!conflict || conflict.kind !== "mvr_alternatives") {
		return payload;
	}
	const mvr = readMvrAttrConflict(conflict as unknown as CrdtConflictRecord);
	if (
		!mvr ||
		!["start", "in", "duration", "fadeIn", "fadeOut"].includes(
			mvr.fieldName,
		)
	) {
		return payload;
	}
	const clip = Array.isArray(clips)
		? clips.find((candidate) => getNodeId(candidate) === mvr.nodeId)
		: null;
	const graphClip = clip ?? findClipInProjects(projects, mvr.nodeId);
	if (!graphClip) {
		return payload;
	}
	const current = clipSnapshotTiming(graphClip);
	const currentFieldValue = current[mvr.fieldName];
	const incomingValue =
		mvr.alternatives
			.map(mvrAlternativeValue)
			.find((value) => value !== currentFieldValue) ??
		mvrAlternativeValue(mvr.alternatives[1]);
	const incoming = { ...current, [mvr.fieldName]: incomingValue };
	return withMiniCutConflictDetails(conflict, {
		clipTiming: { current, incoming },
	});
};

const augmentReviewConflict = (
	payload: unknown,
	projects: unknown,
	clips?: unknown,
) =>
	augmentClipTimingConflict(
		augmentDanglingResourceConflict(
			augmentDeleteVsEditConflict(
				augmentTrackOrderConflict(payload, projects),
				projects,
				clips,
			),
		),
		projects,
		clips,
	);

const augmentReviewConflictPayload = (
	payload: unknown,
	projects: unknown,
	clips?: unknown,
) => {
	const value = asRecord(payload);
	if (!value) {
		return payload;
	}
	const next = { ...value };
	for (const key of ["opened", "updated", "acknowledged", "resolved"] as const) {
		const list = value[key];
		if (Array.isArray(list)) {
			next[key] = list.map((item) =>
				augmentReviewConflict(item, projects, clips),
			);
		}
	}
	return next;
};

export const reduceHandleCRDTConflictGraph = (
	payload: unknown,
	projectIdHint?: unknown,
	projects?: unknown,
	clips?: unknown,
	existingReviewItemIds?: unknown,
) => {
	const resolvedProjectIdHint =
		typeof projectIdHint === "string" && projectIdHint.length > 0
			? projectIdHint
			: null;
	const session = reduceCreateReviewSessionWithLifecycleItems(
		augmentReviewConflictPayload(payload, projects, clips),
		projectIdHint,
	);
	const items = session?.rels?.items;
	if (!session || !Array.isArray(items) || items.length === 0) {
		return null;
	}
	const existingIds = new Set(
		Array.isArray(existingReviewItemIds)
			? existingReviewItemIds.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
	);
	const refs = items.map((item, index) => {
		const reviewItemId = item.attrs.reviewItemId;
		return typeof reviewItemId === "string"
			? `reviewItem:${reviewItemId}`
			: `reviewItem:${index}`;
	});
	const newEntries = items
		.map((item, index) => ({ item, ref: refs[index] }))
		.filter(({ item }) => !existingIds.has(String(item.attrs.reviewItemId)));
	const updateReviewItems = items.map((item) => ({
		id: item.attrs.reviewItemId,
		conflictId: item.attrs.conflictId,
		projectId: item.attrs.projectId,
		kind: item.attrs.kind,
		status: item.attrs.status,
		title: item.attrs.title,
		affectedObjects: item.attrs.affectedObjects,
		preview: item.attrs.preview,
		availableActions: item.attrs.availableActions,
		actionTargets: item.attrs.actionTargets,
		source: item.attrs.source,
	}));
	return {
		updateReviewItems,
		reviewItems: newEntries.map(({ item, ref }) => ({
			...item,
			hold_ref_id: ref,
		})),
		...(newEntries.length > 0
			? {
					reviewSession: {
						attrs: session.attrs,
						hold_ref_id: "reviewSession",
					},
					$output: {
						...(payload && typeof payload === "object"
							? (payload as Record<string, unknown>)
							: { value: payload }),
						...(resolvedProjectIdHint
							? { __reviewProjectIdHint: resolvedProjectIdHint }
							: null),
						rels: {
							reviewSession: { use_ref_id: "reviewSession" },
							reviewItem: { use_ref_id: newEntries[0].ref },
						},
					},
				}
			: {}),
	};
};

export const reduceLinkReviewSessionItemsFromOutput = (payload: unknown) => {
	const reviewSession = resolveOutputRelModel(payload, "reviewSession");
	const reviewItemsRaw = resolveOutputRelModel(payload, "reviewItem");
	const reviewItems = Array.isArray(reviewItemsRaw)
		? reviewItemsRaw
		: reviewItemsRaw
			? [reviewItemsRaw]
			: [];
	const reviewSessionId = getNodeId(reviewSession);
	if (!reviewSessionId || reviewItems.length === 0) {
		return null;
	}
	return {
		[reviewSessionId]: {
			rels: {
				items: reviewItems,
			},
		},
	};
};

export const reduceHandleCRDTSyncGraph = (
	payload: unknown,
	projectIdHint?: unknown,
) => {
	const session = reduceCreateReviewSessionWithActivitySummary(
		payload,
		projectIdHint,
	);
	const activitySummaries = session?.rels?.activitySummaries;
	if (
		!session ||
		!Array.isArray(activitySummaries) ||
		activitySummaries.length === 0
	) {
		return null;
	}
	const refs = activitySummaries.map((summary, index) => {
		const activitySummaryId = summary.attrs.activitySummaryId;
		return typeof activitySummaryId === "string"
			? `activitySummary:${activitySummaryId}`
			: `activitySummary:${index}`;
	});
	return {
		activitySummaries: activitySummaries.map((summary, index) => ({
			...summary,
			hold_ref_id: refs[index],
		})),
		reviewSession: {
			attrs: session.attrs,
			hold_ref_id: "reviewSession",
		},
		$output: {
			...(payload && typeof payload === "object"
				? (payload as Record<string, unknown>)
				: { value: payload }),
			rels: {
				reviewSession: { use_ref_id: "reviewSession" },
				activitySummary: { use_ref_id: refs[0] },
			},
		},
	};
};

export const reduceLinkReviewSessionActivityFromOutput = (payload: unknown) => {
	const reviewSession = resolveOutputRelModel(payload, "reviewSession");
	const activitySummary = resolveOutputRelModel(payload, "activitySummary");
	const reviewSessionId = getNodeId(reviewSession);
	if (!reviewSessionId || !activitySummary) {
		return null;
	}
	return {
		[reviewSessionId]: {
			rels: {
				activitySummaries: [activitySummary],
			},
		},
	};
};

export const reduceSelectReviewItem = (payload: unknown) => {
	const value =
		payload && typeof payload === "object"
			? (payload as { reviewItemId?: unknown; review_item_id?: unknown })
			: null;
	const reviewItemId =
		typeof value?.reviewItemId === "string"
			? value.reviewItemId
			: typeof value?.review_item_id === "string"
				? value.review_item_id
				: typeof payload === "string"
					? payload
					: null;
	return { activeReviewItemId: reviewItemId };
};

export const reduceAcknowledgeReviewItem = (payload: unknown) => {
	const value =
		payload && typeof payload === "object"
			? (payload as {
					conflictId?: unknown;
					conflict_id?: unknown;
					reviewItemId?: unknown;
					review_item_id?: unknown;
					action?: unknown;
				})
			: null;
	const conflictId =
		typeof value?.conflictId === "string"
			? value.conflictId
			: typeof value?.conflict_id === "string"
				? value.conflict_id
				: "";
	const reviewItemId =
		typeof value?.reviewItemId === "string"
			? value.reviewItemId
			: typeof value?.review_item_id === "string"
				? value.review_item_id
				: "";
	return makeCrdtAcknowledgePayload({
		conflictId,
		reviewItemId,
		action:
			typeof value?.action === "string"
				? value.action
				: "acknowledgeReviewItem",
	});
};
