import {
	affectedObjectFromConflict,
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";

const includesToken = (value: string | null | undefined, token: string) =>
	typeof value === "string" && value.toLowerCase().includes(token);

export const danglingResourceFeature = {
	kind: "dangling_resource" as const,
	actions: ["resolveDanglingResourceByRelink", "keepOfflinePlaceholder"],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		return (
			conflict.aggregate === "resourceLifecycle" ||
			includesToken(conflict.kind, "dangling") ||
			includesToken(conflict.kind, "orphan") ||
			includesToken(conflict.kind, "missing")
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
			kind: "dangling_resource",
			status: conflict.status,
			title: "Missing media reference",
			affectedObjects: affectedObjectFromConflict(conflict),
			preview: {
				type: "dangling_resource",
				conflictId: conflict.conflict_id,
				payload: conflict.payload ?? null,
				details: conflict.details ?? null,
				variants: conflict.variants ?? null,
			},
			availableActions: [
				"resolveDanglingResourceByRelink",
				"keepOfflinePlaceholder",
			],
			source: sourceFromConflict(conflict),
		};
	},
};

