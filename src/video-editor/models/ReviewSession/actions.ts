import { materializeCRDTConflictReviewItem } from "../../dkt/review/materializeCRDTConflictReviewItem";
import { materializeCRDTSyncSummary } from "../../dkt/review/materializeCRDTSyncSummary";
import type {
	CrdtConflictLifecyclePayload,
	CrdtConflictRecord,
	CrdtSyncPayload,
	MiniCutActivitySummary,
	MiniCutReviewItem,
} from "../../dkt/review/types";
import { activitySummaryAttrsFromSummary } from "../ActivitySummary/actions";
import { reviewItemAttrsFromItem } from "../ReviewItem/actions";

const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const getNodeId = (model: unknown): string | null =>
	model &&
	typeof model === "object" &&
	typeof (model as { _node_id?: unknown })._node_id === "string"
		? (model as { _node_id: string })._node_id
		: null;

export const reduceCreateReviewSession = (
	payload: unknown,
	projectIdHint: unknown,
) => {
	const value = asObject<{
		reviewSessionId?: unknown;
		projectId?: unknown;
		filters?: unknown;
	}>(payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	if (!projectId) {
		return null;
	}
	const now = Date.now();
	return {
		attrs: {
			reviewSessionId:
				asString(value?.reviewSessionId) ?? `review-session:${projectId}`,
			projectId,
			status: "open",
			selectedReviewItemId: null,
			filters:
				value?.filters && typeof value.filters === "object"
					? value.filters
					: { status: "unresolved" },
			openedAt: now,
			updatedAt: now,
		},
	};
};

export const reviewSessionAttrsForProject = (projectId: string) => {
	const now = Date.now();
	return {
		reviewSessionId: `review-session:${projectId}`,
		projectId,
		status: "open",
		selectedReviewItemId: null,
		filters: { status: "unresolved" },
		openedAt: now,
		updatedAt: now,
	};
};

export const reviewItemCreationFromItem = (item: MiniCutReviewItem) => ({
	attrs: {
		...reviewItemAttrsFromItem(item),
		createdAt: Date.now(),
	},
});

export const activitySummaryCreationFromSummary = (
	summary: MiniCutActivitySummary,
) => ({
	attrs: activitySummaryAttrsFromSummary(summary),
});

export const reduceCreateReviewSessionWithItem = (
	payload: unknown,
	projectIdHint: unknown,
) => {
	const value = asObject<{ conflict?: unknown; projectId?: unknown }>(payload);
	const conflict = asObject<CrdtConflictRecord>(value?.conflict ?? payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	if (!conflict || !asString(conflict.conflict_id) || !projectId) {
		return null;
	}
	const item = materializeCRDTConflictReviewItem({ conflict, projectId });
	return {
		attrs: {
			...reviewSessionAttrsForProject(projectId),
			selectedReviewItemId: item.id,
		},
		rels: {
			items: [reviewItemCreationFromItem(item)],
		},
	};
};

const lifecycleRecords = (payload: unknown): CrdtConflictRecord[] => {
	const value = asObject<CrdtConflictLifecyclePayload>(payload);
	if (!value) {
		return [];
	}
	return [
		...(Array.isArray(value.opened) ? value.opened : []),
		...(Array.isArray(value.updated) ? value.updated : []),
		...(Array.isArray(value.acknowledged) ? value.acknowledged : []),
		...(Array.isArray(value.resolved) ? value.resolved : []),
	];
};

export const reduceCreateReviewSessionWithLifecycleItems = (
	payload: unknown,
	projectIdHint: unknown,
) => {
	const value = asObject<{ projectId?: unknown }>(payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	const records = lifecycleRecords(payload);
	if (!projectId || records.length === 0) {
		return reduceCreateReviewSessionWithItem(payload, projectIdHint);
	}
	const itemsById = new Map<string, ReturnType<typeof reviewItemCreationFromItem>>();
	for (const conflict of records) {
		if (!asString(conflict.conflict_id)) {
			continue;
		}
		const item = materializeCRDTConflictReviewItem({ conflict, projectId });
		itemsById.delete(item.id);
		itemsById.set(item.id, reviewItemCreationFromItem(item));
	}
	const items = [...itemsById.values()];
	if (items.length === 0) {
		return null;
	}
	const selectedReviewItemId = items[0]?.attrs.reviewItemId;
	return {
		attrs: {
			...reviewSessionAttrsForProject(projectId),
			selectedReviewItemId:
				typeof selectedReviewItemId === "string" ? selectedReviewItemId : null,
		},
		rels: { items },
	};
};

export const reduceCreateReviewSessionWithActivitySummary = (
	payload: unknown,
	projectIdHint: unknown,
) => {
	const value = asObject<{ payload?: unknown; projectId?: unknown }>(payload);
	const syncPayload = asObject<CrdtSyncPayload>(value?.payload ?? payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	if (!syncPayload || !asString(syncPayload.batch_id) || !projectId) {
		return null;
	}
	const summary = materializeCRDTSyncSummary({ payload: syncPayload, projectId });
	return {
		attrs: reviewSessionAttrsForProject(projectId),
		rels: {
			activitySummaries: [activitySummaryCreationFromSummary(summary)],
		},
	};
};

export const reduceSelectReviewItem = (payload: unknown) => {
	const value = asObject<{ reviewItemId?: unknown }>(payload);
	const reviewItemId = asString(value?.reviewItemId) ?? asString(payload);
	if (!reviewItemId) {
		return null;
	}
	return {
		selectedReviewItemId: reviewItemId,
		updatedAt: Date.now(),
	};
};

export const reduceAttachReviewItemFromOutput = (
	payload: unknown,
	self: unknown,
) => {
	const rels = asObject<{ reviewSession?: unknown; reviewItem?: unknown }>(
		(payload as { rels?: unknown } | null)?.rels,
	);
	const targetSession = rels?.reviewSession;
	const selfId = getNodeId(self);
	const targetSessionId = getNodeId(targetSession);
	const item = rels?.reviewItem;
	return item && selfId && selfId === targetSessionId ? [item] : null;
};

export const reduceAttachActivitySummaryFromOutput = (
	payload: unknown,
	self: unknown,
) => {
	const rels = asObject<{ reviewSession?: unknown; activitySummary?: unknown }>(
		(payload as { rels?: unknown } | null)?.rels,
	);
	const targetSession = rels?.reviewSession;
	const selfId = getNodeId(self);
	const targetSessionId = getNodeId(targetSession);
	const summary = rels?.activitySummary;
	return summary && selfId && selfId === targetSessionId ? [summary] : null;
};
