import {
	affectedObjectFromConflict,
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";

const hasDeleteEditShape = (value: unknown): boolean =>
	Boolean(
		value &&
			typeof value === "object" &&
			("tombstone" in value || "deleted" in value) &&
			("edit" in value || "edited" in value || "concurrent" in value),
	);

export const deleteVsEditFeature = {
	kind: "delete_vs_edit" as const,
	actions: [
		"resolveDeleteVsEditByRestoreVariant",
		"parkEditedVariantOnReviewTrack",
		"preserveDeleteAndArchiveIncomingEdit",
	],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		return (
			conflict.kind.toLowerCase().includes("delete") ||
			conflict.aggregate === "clipLifecycle" ||
			hasDeleteEditShape(conflict.payload)
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
			kind: "delete_vs_edit",
			status: conflict.status,
			title: "Deleted item was edited elsewhere",
			affectedObjects: affectedObjectFromConflict(conflict),
			preview: {
				type: "delete_vs_edit",
				conflictId: conflict.conflict_id,
				payload: conflict.payload ?? null,
				details: conflict.details ?? null,
				variants: conflict.variants ?? null,
			},
			availableActions: [
				"resolveDeleteVsEditByRestoreVariant",
				"parkEditedVariantOnReviewTrack",
				"preserveDeleteAndArchiveIncomingEdit",
			],
			source: sourceFromConflict(conflict),
		};
	},
};

