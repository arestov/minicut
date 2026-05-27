import type { CrdtConflictRecord } from "../../types";
import { readStructuralDeleteRelationConflict } from "../../dktConflictNormalizers";
import { readMiniCutConflictDetails } from "../../minicutConflictEnrichment";
import { materializeDeleteVsEditReviewItem } from "./materializeDeleteVsEditReviewItem";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const deleteVsEditFeature = {
	kind: "delete_vs_edit" as const,
	actions: [
		"resolveDeleteVsEditByRestoreVariant",
		"parkEditedVariantOnReviewTrack",
		"preserveDeleteAndArchiveIncomingEdit",
	],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		const structural = readStructuralDeleteRelationConflict(conflict);
		const minicut = readMiniCutConflictDetails(conflict).deleteVsEdit;
		return (
			structural?.relationName === "clips" &&
			isRecord(minicut) &&
			isRecord(minicut.deleted) &&
			isRecord(minicut.edited)
		);
	},
	materialize: materializeDeleteVsEditReviewItem,
};

export { materializeDeleteVsEditReviewItem };
export type {
	DeleteVsEditDeletedVariant,
	DeleteVsEditEditedVariant,
	DeleteVsEditPreview,
} from "./deleteVsEditPreview";
