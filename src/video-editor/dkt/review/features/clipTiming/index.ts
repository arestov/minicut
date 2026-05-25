import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import {
	containsClipTimingAlternatives,
	clipTimingFields,
} from "./clipTimingPreview";
import { materializeClipTimingReviewItem } from "./materializeClipTimingReviewItem";

const timingFields = new Set<string>(clipTimingFields);

const isStructuralConflict = (conflict: CrdtConflictRecord): boolean =>
	conflict.aggregate === "clipLifecycle" ||
	conflict.aggregate === "resourceLifecycle" ||
	conflict.field_kind === "rel" ||
	conflict.kind.toLowerCase().includes("delete") ||
	conflict.kind.toLowerCase().includes("dangling") ||
	conflict.kind.toLowerCase().includes("orphan");

export const clipTimingFeature = {
	kind: "clip_timing" as const,
	actions: ["resolveClipTimingConflict", "parkIncomingVariantOnReviewTrack"],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		if (isStructuralConflict(conflict)) {
			return false;
		}
		return (
			conflict.aggregate === "clipTiming" ||
			(conflict.model_name === "clip" &&
				typeof conflict.field_name === "string" &&
				timingFields.has(conflict.field_name)) ||
			containsClipTimingAlternatives(conflict.payload) ||
			containsClipTimingAlternatives(conflict.details) ||
			containsClipTimingAlternatives(conflict.variants)
		);
	},
	materialize({
		conflict,
		projectId,
	}: {
		conflict: CrdtConflictRecord;
		projectId: string;
	}): MiniCutReviewItem {
		return materializeClipTimingReviewItem({ conflict, projectId });
	},
};

export { materializeClipTimingReviewItem };
export {
	clipTimingFields,
	extractClipTimingPreview,
	parseClipTimingVariant,
} from "./clipTimingPreview";
