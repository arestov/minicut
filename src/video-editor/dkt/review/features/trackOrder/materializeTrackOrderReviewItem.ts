import {
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { extractTrackOrderPreview } from "./trackOrderPreview";

export const materializeTrackOrderReviewItem = ({
	conflict,
	projectId,
}: {
	conflict: CrdtConflictRecord;
	projectId: string;
}): MiniCutReviewItem => {
	const preview = extractTrackOrderPreview(conflict);
	return {
		id: reviewItemIdForConflict(conflict.conflict_id),
		conflictId: conflict.conflict_id,
		projectId,
		kind: "track_order",
		status: conflict.status,
		title: "Track order changed while offline",
		affectedObjects: preview.currentOrder.map((track) => ({
			type: "track",
			id: track.trackId,
			label: track.name,
		})),
		preview,
		availableActions: [
			"resolveTrackOrderConflict",
			"preserveCurrentTrackOrder",
			"createManualTrackOrderSuggestion",
		],
		actionTargets: {
			resolveTrackOrderConflict: { type: "project", id: projectId },
			preserveCurrentTrackOrder: { type: "project", id: projectId },
			createManualTrackOrderSuggestion: { type: "project", id: projectId },
		},
		source: sourceFromConflict(conflict),
	};
};
