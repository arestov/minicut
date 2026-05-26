import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { materializeTrackOrderReviewItem } from "./materializeTrackOrderReviewItem";

const trackOrderKindPattern = /(track.*(order|sequence|ordered))|((order|sequence|ordered).*track)/i;

export const trackOrderFeature = {
	kind: "track_order" as const,
	actions: [
		"resolveTrackOrderConflict",
		"preserveCurrentTrackOrder",
		"createManualTrackOrderSuggestion",
	],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		return (
			conflict.aggregate === "projectTracks" ||
			conflict.field_name === "tracks" ||
			trackOrderKindPattern.test(conflict.kind)
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
