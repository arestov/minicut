import type { CrdtConflictRecord } from "../../types";
import { readMvrAttrConflict } from "../../dktConflictNormalizers";
import { readMiniCutConflictDetails } from "../../minicutConflictEnrichment";

export const clipTimingFields = [
	"start",
	"in",
	"duration",
	"fadeIn",
	"fadeOut",
] as const;

export type ClipTimingField = (typeof clipTimingFields)[number];
export type ClipTimingVariant = Record<ClipTimingField, number>;
export type ClipTimingPreview = {
	type: "clip_timing";
	current: ClipTimingVariant;
	incoming: ClipTimingVariant;
	fields: ClipTimingField[];
};

const fieldSet = new Set<string>(clipTimingFields);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseClipTimingVariant = (
	value: unknown,
): ClipTimingVariant | null => {
	if (!isRecord(value)) {
		return null;
	}
	const start = value.start;
	const inPoint = value.in;
	const duration = value.duration;
	if (
		typeof start !== "number" ||
		typeof inPoint !== "number" ||
		typeof duration !== "number" ||
		!Number.isFinite(start) ||
		!Number.isFinite(inPoint) ||
		!Number.isFinite(duration)
	) {
		return null;
	}
	const fadeIn = value.fadeIn;
	const fadeOut = value.fadeOut;
	return {
		start,
		in: inPoint,
		duration,
		fadeIn: typeof fadeIn === "number" && Number.isFinite(fadeIn) ? fadeIn : 0,
		fadeOut:
			typeof fadeOut === "number" && Number.isFinite(fadeOut) ? fadeOut : 0,
	};
};

const previewFromSource = (source: unknown): ClipTimingPreview | null => {
	if (!isRecord(source)) {
		return null;
	}
	if (isRecord(source.details)) {
		const nested = previewFromSource(source.details);
		if (nested) {
			return nested;
		}
	}
	const current = parseClipTimingVariant(source.current);
	const incoming = parseClipTimingVariant(source.incoming);
	if (!current || !incoming) {
		return null;
	}
	const fields = clipTimingFields.filter(
		(field) => fieldSet.has(field) && current[field] !== incoming[field],
	);
	return {
		type: "clip_timing",
		current,
		incoming,
		fields: fields.length > 0 ? fields : ["start", "in", "duration"],
	};
};

export const extractClipTimingPreview = (
	conflict: Pick<
		CrdtConflictRecord,
		"kind" | "node_id" | "payload" | "details" | "variants" | "field_name"
	> & { alternatives?: unknown },
): ClipTimingPreview => {
	const preview =
		previewFromSource(readMiniCutConflictDetails(conflict).clipTiming);
	const mvr = readMvrAttrConflict(conflict);
	if (!mvr || !fieldSet.has(mvr.fieldName)) {
		throw new Error("Clip timing conflict requires typed timing MVR payload");
	}
	if (!preview) {
		throw new Error("Clip timing conflict requires MiniCut preview details");
	}
	return preview;
};

export const containsClipTimingAlternatives = (value: unknown): boolean => {
	try {
		const details = readMiniCutConflictDetails({
			details: isRecord(value) ? value.details : null,
		});
		return previewFromSource(details.clipTiming) !== null;
	} catch {
		return false;
	}
};
