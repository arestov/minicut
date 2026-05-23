import {
	affectedObjectFromConflict,
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";

export const trackOrderFeature = {
	kind: "track_order" as const,
	actions: [
		"resolveTrackOrderConflict",
		"preserveCurrentTrackOrder",
		"createManualTrackOrderSuggestion",
	],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		return (
			conflict.aggregate === "projectTracks" ||
			conflict.field_name === "tracks" ||
			conflict.kind.toLowerCase().includes("ordered") ||
			conflict.kind.toLowerCase().includes("sequence")
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
			kind: "track_order",
			status: conflict.status,
			title: "Track order changed while offline",
			affectedObjects: affectedObjectFromConflict(conflict),
			preview: {
				type: "track_order",
				conflictId: conflict.conflict_id,
				payload: conflict.payload ?? null,
				details: conflict.details ?? null,
				variants: conflict.variants ?? null,
			},
			availableActions: [
				"resolveTrackOrderConflict",
				"preserveCurrentTrackOrder",
				"createManualTrackOrderSuggestion",
			],
			source: sourceFromConflict(conflict),
		};
	},
};

