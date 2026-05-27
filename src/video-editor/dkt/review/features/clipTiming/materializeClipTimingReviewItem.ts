import {
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type {
	CrdtConflictRecord,
	MiniCutReviewActionTarget,
	MiniCutReviewItem,
} from "../../types";
import { extractClipTimingPreview } from "./clipTimingPreview";

const projectTarget = (projectId: string): MiniCutReviewActionTarget => ({
	type: "project",
	id: projectId,
});

export const materializeClipTimingReviewItem = ({
	conflict,
	projectId,
}: {
	conflict: CrdtConflictRecord;
	projectId: string;
}): MiniCutReviewItem => {
	const clipId =
		typeof conflict.node_id === "string" && conflict.node_id.length > 0
			? conflict.node_id
			: null;
	if (!clipId) {
		throw new Error("Clip timing conflict requires clip id");
	}
	return {
		id: reviewItemIdForConflict(conflict.conflict_id),
		conflictId: conflict.conflict_id,
		projectId,
		kind: "clip_timing",
		status: conflict.status,
		title: "Clip timing conflict",
		affectedObjects: [{ type: "clip", id: clipId, label: "Clip" }],
		preview: extractClipTimingPreview(conflict),
		resolution: conflict.resolution ?? null,
		availableActions: [
			"resolveClipTimingConflict",
			"parkIncomingVariantOnReviewTrack",
		],
		actionTargets: {
			resolveClipTimingConflict: { type: "clip", id: clipId },
			parkIncomingVariantOnReviewTrack: projectTarget(projectId),
		},
		source: sourceFromConflict(conflict),
	};
};
