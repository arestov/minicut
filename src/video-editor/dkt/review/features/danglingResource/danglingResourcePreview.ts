import type { CrdtConflictRecord } from "../../types";
import { readDanglingRefConflict } from "../../dktConflictNormalizers";

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

const firstString = (
	source: Record<string, unknown>,
	keys: readonly string[],
): string | null => {
	for (const key of keys) {
		const value = stringValue(source[key]);
		if (value) return value;
	}
	return null;
};

const nestedRecord = (
	source: Record<string, unknown>,
	keys: readonly string[],
): Record<string, unknown> | null => {
	for (const key of keys) {
		const value = source[key];
		if (isRecord(value)) return value;
	}
	return null;
};

const collectPayloadRecords = (
	conflict: CrdtConflictRecord,
): Record<string, unknown>[] =>
	[conflict.payload, conflict.details, conflict.variants].flatMap((value) => {
		if (!isRecord(value)) return [];
		const records = [value];
		const resource = nestedRecord(value, ["resource", "missingResource"]);
		const reference = nestedRecord(value, ["reference", "missingReference"]);
		if (resource) records.push(resource);
		if (reference) records.push(reference);
		return records;
	});

export const extractDanglingResourcePreview = (
	conflict: CrdtConflictRecord,
): DanglingResourcePreview => {
	const danglingRef = readDanglingRefConflict(conflict);
	const records = collectPayloadRecords(conflict);
	const resourceId =
		(danglingRef?.fieldName === "resource" ? danglingRef.targetNodeId : null) ??
		records
			.map((record) =>
				firstString(record, [
					"resourceId",
					"resource_id",
					"missingResourceId",
					"targetResourceId",
					"id",
				]),
			)
			.find(Boolean) ??
		(conflict.model_name === "resource" ||
		conflict.aggregate === "resourceLifecycle"
			? stringValue(conflict.node_id)
			: null);
	if (!resourceId) {
		throw new Error("Dangling resource conflict requires resource id");
	}

	const clipIds = [
		...new Set(
			records.flatMap((record) => {
				const directClipId = stringValue(record.clipId);
				return [
					...stringArray(record.clipIds),
					...stringArray(record.clip_ids),
					...stringArray(record.affectedClipIds),
					...stringArray(record.affected_clip_ids),
					...(danglingRef?.fieldName === "resource"
						? [danglingRef.sourceNodeId]
						: []),
					...(directClipId ? [directClipId] : []),
				];
			}),
		),
	];

	return {
		type: "dangling_resource",
		resourceId,
		resourceName:
			records
				.map((record) =>
					firstString(record, ["resourceName", "resource_name", "name"]),
				)
				.find(Boolean) ?? "Missing media",
		resourceKind:
			records
				.map((record) =>
					firstString(record, ["resourceKind", "resource_kind", "kind"]),
				)
				.find(Boolean) ?? "media",
		clipIds,
		missingUrl:
			records
				.map((record) =>
					firstString(record, ["missingUrl", "missing_url", "url"]),
				)
				.find(Boolean) ?? null,
		lastKnownSource:
			records
				.map((record) => nestedRecord(record, ["lastKnownSource", "source"]))
				.find(Boolean) ?? null,
	};
};
