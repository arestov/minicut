import type { CrdtConflictRecord } from "../../types";
import { materializeDeleteVsEditReviewItem } from "./materializeDeleteVsEditReviewItem";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasDeleteEditShape = (value: unknown): boolean => {
	if (!isRecord(value)) {
		return false;
	}
	const hasDelete = isRecord(value.tombstone) || isRecord(value.deleted);
	const hasEdit =
		isRecord(value.edit) || isRecord(value.edited) || isRecord(value.concurrent);
	return hasDelete && hasEdit;
};

const lifecycleRecordDescribesDeleteEdit = (value: unknown): boolean =>
	isRecord(value) &&
	(value.concurrent === "delete_edit" ||
		value.conflict === "delete_edit" ||
		value.reason === "delete_vs_edit" ||
		hasDeleteEditShape(value));

const lifecyclePayloadDescribesDeleteEdit = (value: unknown): boolean => {
	if (!isRecord(value)) {
		return false;
	}
	return Object.values(value).some((entry) =>
		Array.isArray(entry)
			? entry.some(lifecycleRecordDescribesDeleteEdit)
			: lifecycleRecordDescribesDeleteEdit(entry),
	);
};

export const deleteVsEditFeature = {
	kind: "delete_vs_edit" as const,
	actions: [
		"resolveDeleteVsEditByRestoreVariant",
		"parkEditedVariantOnReviewTrack",
		"preserveDeleteAndArchiveIncomingEdit",
	],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		const kind = conflict.kind.toLowerCase();
		if (
			kind.includes("dangling") ||
			kind.includes("track_order") ||
			kind.includes("ordering")
		) {
			return false;
		}
		if (hasDeleteEditShape(conflict.payload)) {
			return true;
		}
		if (
			(kind.includes("delete") && kind.includes("edit")) ||
			kind.includes("structural_delete_with_concurrent_activity")
		) {
			return true;
		}
		return (
			(conflict.aggregate === "clipLifecycle" ||
				conflict.aggregate === "resourceLifecycle") &&
			lifecyclePayloadDescribesDeleteEdit(conflict.payload)
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
