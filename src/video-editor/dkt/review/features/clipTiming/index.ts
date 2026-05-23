import {
	affectedObjectFromConflict,
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";

const timingFields = new Set(["start", "in", "duration", "fadeIn", "fadeOut"]);

export const clipTimingFeature = {
	kind: "clip_timing" as const,
	actions: ["resolveClipTimingConflict"],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		return (
			conflict.aggregate === "clipTiming" ||
			(conflict.model_name === "clip" &&
				typeof conflict.field_name === "string" &&
				timingFields.has(conflict.field_name))
		);
	},
	materialize({
		conflict,
		projectId,
	}: {
		conflict: CrdtConflictRecord;
		projectId: string;
	}): MiniCutReviewItem {
		return {
			id: reviewItemIdForConflict(conflict.conflict_id),
			conflictId: conflict.conflict_id,
			projectId,
			kind: "clip_timing",
			status: conflict.status,
			title: "Clip timing conflict",
			affectedObjects: affectedObjectFromConflict(conflict),
			preview: {
				type: "clip_timing",
				conflictId: conflict.conflict_id,
				payload: conflict.payload ?? null,
				details: conflict.details ?? null,
				variants: conflict.variants ?? null,
			},
			availableActions: ["resolveClipTimingConflict"],
			source: sourceFromConflict(conflict),
		};
	},
};
