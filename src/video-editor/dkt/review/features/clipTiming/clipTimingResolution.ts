import type { MiniCutReviewItem } from "../../types";
import {
	clipTimingFields,
	type ClipTimingField,
	type ClipTimingPreview,
	type ClipTimingVariant,
} from "./clipTimingPreview";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const formatClipTimingValue = (value: number): string =>
	`${Number(value.toFixed(3))}s`;

/** Fields an open clip timing inspector shows: the conflicting ones plus both fades. */
export const visibleClipTimingFields = (
	preview: ClipTimingPreview,
): ClipTimingField[] =>
	clipTimingFields.filter(
		(field) =>
			preview.fields.includes(field) ||
			field === "fadeIn" ||
			field === "fadeOut",
	);

const timingFromRecord = (value: unknown): ClipTimingVariant | null => {
	if (!isRecord(value)) {
		return null;
	}
	const result = Object.fromEntries(
		clipTimingFields.map((field) => [field, value[field]]),
	) as Record<ClipTimingField, unknown>;
	return clipTimingFields.every(
		(field) =>
			typeof result[field] === "number" && Number.isFinite(result[field]),
	)
		? (result as ClipTimingVariant)
		: null;
};

export type ClipTimingResolutionSummary = {
	/** "current", "incoming", "custom", "park_incoming" ...; null when not reported. */
	variant: string | null;
	appliedTiming: ClipTimingVariant | null;
	parkedClipId: string | null;
};

/** Reads what a resolved clip timing item reports about its resolution. */
export const readClipTimingResolutionSummary = (
	item: MiniCutReviewItem,
): ClipTimingResolutionSummary => {
	const resolution = isRecord(item.resolution) ? item.resolution : null;
	const domainResult = isRecord(resolution?.domain_result)
		? resolution.domain_result
		: null;
	const parkedClipId = domainResult?.parkedClipId;
	const variant = domainResult?.variant ?? domainResult?.selectedVariant;
	return {
		variant: typeof variant === "string" ? variant : null,
		appliedTiming:
			timingFromRecord(domainResult?.sourceTiming) ??
			timingFromRecord(domainResult) ??
			null,
		parkedClipId: isRecord(parkedClipId)
			? "parked clip"
			: typeof parkedClipId === "string"
				? parkedClipId
				: null,
	};
};
