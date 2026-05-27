import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { readSequenceMoveConflict } from "../../dktConflictNormalizers";
import { readMiniCutConflictDetails } from "../../minicutConflictEnrichment";
import { materializeTrackOrderReviewItem } from "./materializeTrackOrderReviewItem";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const trackOrderFeature = {
	kind: "track_order" as const,
	actions: [
		"resolveTrackOrderConflict",
		"preserveCurrentTrackOrder",
		"createManualTrackOrderSuggestion",
	],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		const sequence = readSequenceMoveConflict(conflict);
		return (
			sequence?.relationName === "tracks" &&
			isRecord(readMiniCutConflictDetails(conflict).trackOrder)
		);
	},
	materialize({
		conflict,
		projectId,
	}: {
		conflict: CrdtConflictRecord;
		projectId: string;
	}): MiniCutReviewItem {
		return materializeTrackOrderReviewItem({ conflict, projectId });
	},
};

export { materializeTrackOrderReviewItem };
export {
	extractTrackOrderPreview,
	type TrackOrderEntry,
	type TrackOrderPreview,
} from "./trackOrderPreview";
