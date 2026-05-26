import {
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { extractDanglingResourcePreview } from "./danglingResourcePreview";

export const materializeDanglingResourceReviewItem = ({
	conflict,
	projectId,
}: {
	conflict: CrdtConflictRecord;
	projectId: string;
}): MiniCutReviewItem => {
	const preview = extractDanglingResourcePreview(conflict);
	return {
		id: reviewItemIdForConflict(conflict.conflict_id),
		conflictId: conflict.conflict_id,
		projectId,
		kind: "dangling_resource",
		status: conflict.status,
		title: "Missing media reference",
		affectedObjects: [
			{
				type: "resource",
				id: preview.resourceId,
				label: preview.resourceName,
			},
			...preview.clipIds.map((clipId) => ({
				type: "clip",
				id: clipId,
				label: "Clip",
			})),
		],
		preview,
		availableActions: [
			"resolveDanglingResourceByRelink",
			"keepOfflinePlaceholder",
		],
		actionTargets: {
			resolveDanglingResourceByRelink: {
				type: "resource",
				id: preview.resourceId,
			},
			keepOfflinePlaceholder: {
				type: "resource",
				id: preview.resourceId,
			},
		},
		source: sourceFromConflict(conflict),
	};
};
