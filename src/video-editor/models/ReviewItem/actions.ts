import { materializeCRDTConflictReviewItem } from "../../dkt/review/materializeCRDTConflictReviewItem";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../dkt/review/types";
import type {
	TrackOrderEntry,
	TrackOrderPreview,
} from "../../dkt/review/features/trackOrder";

const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const isUniqueStringList = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.every((entry): entry is string => typeof entry === "string") &&
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
	trackIds: readonly string[],
	preview: TrackOrderPreview,
): TrackOrderEntry[] => {
	const entries = new Map(
		[...preview.currentOrder, ...preview.incomingOrder].map((entry) => [
			entry.trackId,
			entry,
		]),
	);
	return trackIds.flatMap((trackId) => {
		const entry = entries.get(trackId);
		return entry ? [entry] : [];
	});
};

export const asNowMs = (now: unknown): number =>
	typeof now === "number" && Number.isFinite(now) ? now : 0;

export const reviewItemAttrsFromItem = (
	item: MiniCutReviewItem,
	now: unknown,
) => ({
	reviewItemId: item.id,
	conflictId: item.conflictId,
	projectId: item.projectId,
	kind: item.kind,
	status: item.status,
	title: item.title,
	affectedObjects: item.affectedObjects,
	preview: item.preview,
	resolution: item.resolution ?? null,
	availableActions: item.availableActions,
	actionTargets: item.actionTargets,
	source: item.source,
	updatedAt: asNowMs(now),
});

export const reduceCreateReviewItem = (payload: unknown, now?: unknown) => {
	const item = asObject<MiniCutReviewItem>(payload);
	if (!item || !asString(item.id) || !asString(item.conflictId)) {
		return null;
	}
	return {
		attrs: {
			...reviewItemAttrsFromItem(item, now),
			createdAt: asNowMs(now),
		},
	};
};

const reviewItemsFromPayload = (payload: unknown): MiniCutReviewItem[] =>
	Array.isArray(payload)
		? payload.filter((item): item is MiniCutReviewItem =>
				Boolean(asObject<MiniCutReviewItem>(item)),
			)
		: asObject<MiniCutReviewItem>(payload)
			? [payload as MiniCutReviewItem]
			: [];

export const reduceSetReviewItem = (
	payload: unknown,
	currentReviewItemId?: unknown,
	now?: unknown,
) => {
	const items = reviewItemsFromPayload(payload);
	const item =
		typeof currentReviewItemId === "string"
			? items.find((entry) => entry.id === currentReviewItemId)
			: items[0];
	if (!item || !asString(item.id) || !asString(item.conflictId)) {
		return null;
	}
	return reviewItemAttrsFromItem(item, now);
};

export const reduceMaterializeReviewItemFromConflict = (
	payload: unknown,
	projectIdHint: unknown,
	now?: unknown,
) => {
	const value = asObject<{ conflict?: unknown; projectId?: unknown }>(payload);
	const conflict = asObject<CrdtConflictRecord>(value?.conflict ?? payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	if (!conflict || !asString(conflict.conflict_id) || !projectId) {
		return null;
	}
	return reduceCreateReviewItem(
		materializeCRDTConflictReviewItem({ conflict, projectId }),
		now,
	);
};

export const reduceCreateManualTrackOrderSuggestionOnReviewItem = (
	payload: unknown,
	noop: unknown,
	currentReviewItemId: unknown,
	now?: unknown,
) => {
	const value = asObject<{
		reviewItemId?: unknown;
		review_item_id?: unknown;
		preview?: unknown;
		trackIds?: unknown;
	}>(payload);
	const targetReviewItemId =
		asString(value?.reviewItemId) ?? asString(value?.review_item_id);
	if (
		typeof currentReviewItemId === "string" &&
		targetReviewItemId &&
		targetReviewItemId !== currentReviewItemId
	) {
		return noop;
	}
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
		updatedAt: asNowMs(now),
	};
};
