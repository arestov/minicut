import { clipTimingFeature } from "./features/clipTiming";
import { danglingResourceFeature } from "./features/danglingResource";
import { deleteVsEditFeature } from "./features/deleteVsEdit";
import { trackOrderFeature } from "./features/trackOrder";
import type {
	CrdtConflictRecord,
	MiniCutReviewItem,
	MiniCutReviewKind,
} from "./types";

export type ReviewFeature = {
	kind: MiniCutReviewKind;
	canMaterialize(conflict: CrdtConflictRecord): boolean;
	materialize(input: {
		conflict: CrdtConflictRecord;
		projectId: string;
	}): MiniCutReviewItem;
	actions: string[];
};

export const reviewFeatureRegistry: ReviewFeature[] = [
	clipTimingFeature,
	danglingResourceFeature,
	deleteVsEditFeature,
	trackOrderFeature,
];

export const findReviewFeature = (conflict: CrdtConflictRecord) =>
	reviewFeatureRegistry.find((feature) => feature.canMaterialize(conflict));

