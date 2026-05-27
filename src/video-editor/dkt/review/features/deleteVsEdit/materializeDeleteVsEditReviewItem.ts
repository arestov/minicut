import {
	reviewItemIdForConflict,
	sourceFromConflict,
} from "../../reviewItemSource";
import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { extractDeleteVsEditPreview } from "./deleteVsEditPreview";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringOrUndefined = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const objectLabel = (
	attrs: Record<string, unknown> | undefined,
	fallback: string,
): string => stringOrUndefined(attrs?.name) ?? fallback;

export const materializeDeleteVsEditReviewItem = ({
	conflict,
	projectId,
}: {
	conflict: CrdtConflictRecord;
	projectId: string;
}): MiniCutReviewItem => {
	const preview = extractDeleteVsEditPreview({
		conflict,
	});
	const clipAttrs = preview.editedVariant.clipAttrs;
	const resourceAttrs = preview.editedVariant.resourceAttrs;
	const clipId = preview.deletedVariant.clipId;
	const resourceId =
		preview.deletedVariant.resourceId ??
		stringOrUndefined(resourceAttrs?.resourceId) ??
		null;
	return {
		id: reviewItemIdForConflict(conflict.conflict_id),
		conflictId: conflict.conflict_id,
		projectId,
		kind: "delete_vs_edit",
		status: conflict.status,
		title: "Deleted item was edited elsewhere",
		affectedObjects: [
			...(clipId
				? [
						{
							type: "clip",
							id: clipId,
							label: objectLabel(clipAttrs, "Deleted clip"),
						},
					]
				: []),
			...(resourceId
				? [
						{
							type: "resource",
							id: resourceId,
							label: objectLabel(
								isRecord(resourceAttrs) ? resourceAttrs : undefined,
								"Referenced resource",
							),
						},
					]
				: []),
		],
		preview,
		availableActions: [
			"resolveDeleteVsEditByRestoreVariant",
			"parkEditedVariantOnReviewTrack",
			"preserveDeleteAndArchiveIncomingEdit",
		],
		actionTargets: {
			resolveDeleteVsEditByRestoreVariant: { type: "project", id: projectId },
			parkEditedVariantOnReviewTrack: { type: "project", id: projectId },
			preserveDeleteAndArchiveIncomingEdit: {
				type: "project",
				id: projectId,
			},
		},
		source: sourceFromConflict(conflict),
	};
};
