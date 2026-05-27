import { readStructuralDeleteRelationConflict } from "../../dktConflictNormalizers";
import { readMiniCutConflictDetails } from "../../minicutConflictEnrichment";
import type { CrdtConflictRecord } from "../../types";

export type DeleteVsEditDeletedVariant = {
	clipId: string;
	trackId?: string;
	resourceId?: string;
	deletedAt?: number;
	peerId?: string;
};

export type DeleteVsEditEditedVariant = {
	clipAttrs: Record<string, unknown>;
	resourceAttrs?: Record<string, unknown>;
	effectAttrs?: Array<Record<string, unknown>>;
	timing?: Record<string, unknown>;
};

export type DeleteVsEditPreview = {
	type: "delete_vs_edit";
	deletedVariant: DeleteVsEditDeletedVariant;
	editedVariant: DeleteVsEditEditedVariant;
	restoreTarget?: {
		trackId: string;
		reason: "original_track" | "fallback_track";
	};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringOrUndefined = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const numberOrUndefined = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const recordOrUndefined = (
	value: unknown,
): Record<string, unknown> | undefined => (isRecord(value) ? value : undefined);

const recordArrayOrUndefined = (
	value: unknown,
): Array<Record<string, unknown>> | undefined =>
	Array.isArray(value) ? value.filter(isRecord) : undefined;

const firstRecord = (...values: unknown[]): Record<string, unknown> | undefined =>
	values.find(isRecord) as Record<string, unknown> | undefined;

export const extractDeleteVsEditPreview = (input: {
	conflict: Pick<
		CrdtConflictRecord,
		"kind" | "payload" | "details" | "origin_peer_id" | "happened_at"
	>;
}): DeleteVsEditPreview => {
	const structuralParts = readStructuralDeleteRelationConflict(input.conflict);
	if (!structuralParts || structuralParts.relationName !== "clips") {
		throw new Error("Delete-vs-edit conflict requires typed clips relation payload");
	}
	const minicutDeleteVsEdit = recordOrUndefined(
		readMiniCutConflictDetails(input.conflict).deleteVsEdit,
	);
	const deleted = recordOrUndefined(minicutDeleteVsEdit?.deleted);
	const edited = recordOrUndefined(minicutDeleteVsEdit?.edited);
	if (!deleted || !edited) {
		throw new Error("Delete-vs-edit conflict requires MiniCut preview details");
	}
	const rawClipAttrs = recordOrUndefined(edited?.clipAttrs);
	if (!rawClipAttrs) {
		throw new Error("Delete-vs-edit conflict requires edited clip attrs");
	}
	const clipId = structuralParts.itemNodeId;
	const trackId = structuralParts.ownerNodeId;
	const clipAttrs = rawClipAttrs;
	const resourceAttrs = recordOrUndefined(edited?.resourceAttrs);
	const timing =
		recordOrUndefined(edited?.timing) ??
		(["start", "in", "duration", "fadeIn", "fadeOut"].some(
			(field) => clipAttrs[field] !== undefined,
		)
			? {
					start: clipAttrs.start,
					in: clipAttrs.in,
					duration: clipAttrs.duration,
					fadeIn: clipAttrs.fadeIn,
					fadeOut: clipAttrs.fadeOut,
				}
			: undefined);
	return {
		type: "delete_vs_edit",
		deletedVariant: {
			clipId,
			...(trackId ? { trackId } : null),
			resourceId:
				stringOrUndefined(deleted?.resourceId) ??
				stringOrUndefined(resourceAttrs?.resourceId),
			deletedAt:
				numberOrUndefined(deleted?.deletedAt) ??
				numberOrUndefined(input.conflict.happened_at),
			peerId:
				stringOrUndefined(deleted?.peerId) ??
				stringOrUndefined(input.conflict.origin_peer_id),
		},
		editedVariant: {
			clipAttrs,
			...(resourceAttrs ? { resourceAttrs } : null),
			...(recordArrayOrUndefined(edited?.effectAttrs)
				? {
						effectAttrs: recordArrayOrUndefined(edited?.effectAttrs),
					}
				: null),
			...(timing ? { timing } : null),
		},
		...(trackId
			? {
					restoreTarget: {
						trackId,
						reason: "original_track" as const,
					},
				}
			: null),
	};
};
