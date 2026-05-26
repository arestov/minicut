import type { CrdtConflictRecord, MiniCutReviewItem } from "./types";

export const reviewItemIdForConflict = (conflictId: string): string =>
	`review:${conflictId}`;

export const sourceFromConflict = (
	conflict: CrdtConflictRecord,
): MiniCutReviewItem["source"] => ({
	conflictId: conflict.conflict_id,
	...(conflict.conflict_group_id
		? { conflictGroupId: conflict.conflict_group_id }
		: null),
	...(conflict.batch_id ? { syncBatchId: conflict.batch_id } : null),
	...(typeof conflict.source_frame_id === "number"
		? { frameId: conflict.source_frame_id }
		: null),
	...(typeof conflict.source_root_frame_id === "number"
		? { rootFrameId: conflict.source_root_frame_id }
		: null),
});

export const affectedObjectFromConflict = (
	conflict: CrdtConflictRecord,
): Array<{ type: string; id: string; label?: string }> => {
	if (!conflict.node_id) {
		return [];
	}
	return [
		{
			type: conflict.model_name || "model",
			id: conflict.node_id,
			label: conflict.field_name || conflict.aggregate || conflict.kind,
		},
	];
};

