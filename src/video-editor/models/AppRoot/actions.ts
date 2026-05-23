import { makeCrdtAcknowledgePayload } from "../../dkt/review/crdtReviewCommands";
import { defaultClipTransform } from "../Clip/actions";
import { reduceCreateActivitySummary, reduceMaterializeSyncActivitySummary } from "../ActivitySummary/actions";
import { reduceCreateReviewItem, reduceMaterializeReviewItemFromConflict } from "../ReviewItem/actions";
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
			const nodeId =
				item && typeof item === "object"
					? (item as { node_id?: unknown }).node_id
					: null;
			if (typeof nodeId === "string" && nodeId) {
				ids.add(nodeId);
			}
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
		for (const track of relList(project, "tracks")) {
			for (const clip of relList(track, "clips")) {
				const clipId = getNodeId(clip);
				if (clipId && conflictNodeIds.has(clipId)) {
					return getNodeId(project);
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

export const reduceRouteCRDTConflictToProjects = (
	payload: unknown,
	noop: unknown,
	rootProjectId: unknown,
	projects: unknown,
) => {
	if (!Array.isArray(projects) || projects.length === 0) {
		return [];
	}
	const projectId = resolveReviewProjectIdHint(payload, rootProjectId, projects);
	return projects.map((project) =>
		getNodeId(project) === projectId ? payload : noop,
	);
};

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
) =>
	reduceCreateReviewSessionWithLifecycleItems(payload, projectIdHint);

export const reduceHandleCRDTSync = (
	payload: unknown,
	projectIdHint?: unknown,
) => reduceCreateReviewSessionWithActivitySummary(payload, projectIdHint);

export const reduceHandleCRDTConflictGraph = (
	payload: unknown,
	projectIdHint?: unknown,
) => {
	const session = reduceCreateReviewSessionWithLifecycleItems(
		payload,
		projectIdHint,
	);
	const items = session?.rels?.items;
	if (!session || !Array.isArray(items) || items.length === 0) {
		return null;
	}
	return {
		reviewItems: items,
		reviewSession: {
			attrs: session.attrs,
		},
	};
};

export const reduceLinkReviewSessionItemsFromOutput = (payload: unknown) => {
	const reviewSession = resolveOutputRelModel(payload, "reviewSession");
	const reviewItem = resolveOutputRelModel(payload, "reviewItem");
	const reviewSessionId = getNodeId(reviewSession);
	if (!reviewSessionId || !reviewItem) {
		return null;
	}
	return {
		[reviewSessionId]: {
			rels: {
				items: [reviewItem],
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
