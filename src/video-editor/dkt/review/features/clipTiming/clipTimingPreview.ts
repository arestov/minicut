import type { CrdtConflictRecord } from "../../types";
import { readMvrAttrConflict } from "../../dktConflictNormalizers";

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

const variantKeys = {
	current: ["current", "local", "ours", "base"],
	incoming: ["incoming", "remote", "theirs"],
} as const;

const readVariant = (
	source: Record<string, unknown>,
	keys: readonly string[],
): unknown => {
	for (const key of keys) {
		if (source[key] !== undefined) {
			return source[key];
		}
	}
	return null;
};

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
	const current = parseClipTimingVariant(
		readVariant(source, variantKeys.current),
	);
	const incoming = parseClipTimingVariant(
		readVariant(source, variantKeys.incoming),
	);
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
		previewFromSource(conflict.payload) ??
		previewFromSource(conflict.details) ??
		previewFromSource(conflict.variants) ??
		previewFromMvrFieldAlternatives(conflict);
	if (!preview) {
		throw new Error("Unsupported clip timing conflict payload");
	}
	return preview;
};

const previewFromMvrFieldAlternatives = (
	conflict: Pick<
		CrdtConflictRecord,
		"kind" | "node_id" | "field_name" | "payload"
	> & { alternatives?: unknown },
): ClipTimingPreview | null => {
	const mvr = readMvrAttrConflict(conflict);
	if (!mvr) {
		return null;
	}
	const field = mvr.fieldName;
	if (
		field !== "start" &&
		field !== "in" &&
		field !== "duration" &&
		field !== "fadeIn" &&
		field !== "fadeOut"
	) {
		return null;
	}
	const alternatives = mvr.alternatives;
	const currentValue = alternatives[0];
	const incomingValue = alternatives[1];
	if (
		typeof currentValue !== "number" ||
		typeof incomingValue !== "number" ||
		!Number.isFinite(currentValue) ||
		!Number.isFinite(incomingValue)
	) {
		return null;
	}
	const current = { start: 0, in: 0, duration: 1, fadeIn: 0, fadeOut: 0 };
	const incoming = { ...current };
	current[field] = currentValue;
	incoming[field] = incomingValue;
	return {
		type: "clip_timing",
		current,
		incoming,
		fields: [field],
	};
};

export const containsClipTimingAlternatives = (value: unknown): boolean => {
	try {
		return previewFromSource(value) !== null;
	} catch {
		return false;
	}
};
