import { findReviewFeature } from "./featureRegistry";
import {
	affectedObjectFromConflict,
	reviewItemIdForConflict,
	sourceFromConflict,
} from "./reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "./types";

export const materializeCRDTConflictReviewItem = ({
	conflict,
	projectId,
}: {
	conflict: CrdtConflictRecord;
	projectId: string;
}): MiniCutReviewItem => {
	const feature = findReviewFeature(conflict);
	if (feature) {
		return feature.materialize({ conflict, projectId });
	}

	return {
		id: reviewItemIdForConflict(conflict.conflict_id),
		conflictId: conflict.conflict_id,
		projectId,
		kind: "unknown",
		status: conflict.status,
		title: "CRDT conflict",
		affectedObjects: affectedObjectFromConflict(conflict),
		preview: {
			type: "unknown_conflict",
			conflictId: conflict.conflict_id,
			kind: conflict.kind,
			payload: conflict.payload ?? null,
			details: conflict.details ?? null,
			variants: conflict.variants ?? null,
			impactSummary: conflict.impact_summary ?? null,
		},
		availableActions: ["acknowledgeReviewItem"],
		source: sourceFromConflict(conflict),
	};
};

