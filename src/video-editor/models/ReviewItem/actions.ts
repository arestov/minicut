import { materializeCRDTConflictReviewItem } from "../../dkt/review/materializeCRDTConflictReviewItem";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../dkt/review/types";

const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

export const reviewItemAttrsFromItem = (item: MiniCutReviewItem) => ({
	reviewItemId: item.id,
	conflictId: item.conflictId,
	projectId: item.projectId,
	kind: item.kind,
	status: item.status,
	title: item.title,
	affectedObjects: item.affectedObjects,
	preview: item.preview,
	availableActions: item.availableActions,
	actionTargets: item.actionTargets,
	source: item.source,
	updatedAt: Date.now(),
});

export const reduceCreateReviewItem = (payload: unknown) => {
	const item = asObject<MiniCutReviewItem>(payload);
	if (!item || !asString(item.id) || !asString(item.conflictId)) {
		return null;
	}
	return {
		attrs: {
			...reviewItemAttrsFromItem(item),
			createdAt: Date.now(),
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
) => {
	const items = reviewItemsFromPayload(payload);
	const item =
		typeof currentReviewItemId === "string"
			? items.find((entry) => entry.id === currentReviewItemId)
			: items[0];
	if (!item || !asString(item.id) || !asString(item.conflictId)) {
		return null;
	}
	return reviewItemAttrsFromItem(item);
};

export const reduceMaterializeReviewItemFromConflict = (
	payload: unknown,
	projectIdHint: unknown,
) => {
	const value = asObject<{ conflict?: unknown; projectId?: unknown }>(payload);
	const conflict = asObject<CrdtConflictRecord>(value?.conflict ?? payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	if (!conflict || !asString(conflict.conflict_id) || !projectId) {
		return null;
	}
	return reduceCreateReviewItem(
		materializeCRDTConflictReviewItem({ conflict, projectId }),
	);
};
