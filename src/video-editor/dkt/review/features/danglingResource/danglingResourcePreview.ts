import type { CrdtConflictRecord } from "../../types";
import { readDanglingRefConflict } from "../../dktConflictNormalizers";
import { readMiniCutConflictDetails } from "../../minicutConflictEnrichment";

export type DanglingResourcePreview = {
	type: "dangling_resource";
	resourceId: string;
	resourceName: string;
	resourceKind: string;
	clipIds: string[];
	missingUrl: string | null;
	lastKnownSource: Record<string, unknown> | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringValue = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const stringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];

export const extractDanglingResourcePreview = (
	conflict: CrdtConflictRecord,
): DanglingResourcePreview => {
	const danglingRef = readDanglingRefConflict(conflict);
	if (!danglingRef || danglingRef.fieldName !== "resource") {
		throw new Error("Dangling resource conflict requires typed resource ref payload");
	}
	const minicutDangling = readMiniCutConflictDetails(conflict).danglingResource;
	if (!isRecord(minicutDangling)) {
		throw new Error("Dangling resource conflict requires MiniCut preview details");
	}

	const clipIds = [
		...new Set(
			[danglingRef.sourceNodeId, ...stringArray(minicutDangling.clipIds)].filter(
				(value): value is string => typeof value === "string" && value.length > 0,
			),
		),
	];

	return {
		type: "dangling_resource",
		resourceId: danglingRef.targetNodeId,
		resourceName:
			stringValue(minicutDangling.resourceName) ?? "Missing media",
		resourceKind:
			stringValue(minicutDangling.resourceKind) ?? "media",
		clipIds,
		missingUrl: stringValue(minicutDangling.missingUrl),
		lastKnownSource: isRecord(minicutDangling.lastKnownSource)
			? minicutDangling.lastKnownSource
			: null,
	};
};
