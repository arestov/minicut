import {
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { extractClipTimingPreview } from "./clipTimingPreview";

export const materializeClipTimingReviewItem = ({
	conflict,
	projectId,
}: {
	conflict: CrdtConflictRecord;
	projectId: string;
}): MiniCutReviewItem => ({
	id: reviewItemIdForConflict(conflict.conflict_id),
	conflictId: conflict.conflict_id,
	projectId,
	kind: "clip_timing",
	status: conflict.status,
	title: "Clip timing conflict",
	affectedObjects: [
		{ type: "clip", id: conflict.node_id ?? "", label: "Clip" },
	],
	preview: extractClipTimingPreview(conflict),
	availableActions: [
		"resolveClipTimingConflict",
		"parkIncomingVariantOnReviewTrack",
	],
	source: sourceFromConflict(conflict),
});
