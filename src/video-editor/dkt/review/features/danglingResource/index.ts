import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { extractDanglingResourcePreview } from "./danglingResourcePreview";
import { materializeDanglingResourceReviewItem } from "./materializeDanglingResourceReviewItem";

const includesToken = (value: string | null | undefined, token: string) =>
	typeof value === "string" && value.toLowerCase().includes(token);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const payloadIdentifiesMissingResourceRelation = (
	conflict: CrdtConflictRecord,
): boolean => {
	if (conflict.field_kind !== "rel") return false;
	if (includesToken(conflict.field_name, "resource")) return true;
	const payload = isRecord(conflict.payload) ? conflict.payload : {};
	const relation =
		typeof payload.relation === "string"
			? payload.relation
			: typeof payload.rel === "string"
				? payload.rel
				: null;
	const target =
		typeof payload.target === "string"
			? payload.target
			: typeof payload.targetType === "string"
				? payload.targetType
				: null;
	return (
		includesToken(relation, "resource") ||
		(includesToken(target, "resource") &&
			(includesToken(conflict.kind, "missing") ||
				includesToken(conflict.kind, "dangling") ||
				includesToken(conflict.kind, "orphan")))
	);
};

const isDeleteVsEditClipLifecycle = (conflict: CrdtConflictRecord): boolean =>
	conflict.aggregate === "clipLifecycle" &&
	(includesToken(conflict.kind, "delete") ||
		includesToken(conflict.kind, "tombstone"));

export const danglingResourceFeature = {
	kind: "dangling_resource" as const,
	actions: ["resolveDanglingResourceByRelink", "keepOfflinePlaceholder"],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		if (isDeleteVsEditClipLifecycle(conflict)) return false;
		const looksLikeDanglingResource =
			conflict.aggregate === "resourceLifecycle" ||
			includesToken(conflict.kind, "dangling") ||
			includesToken(conflict.kind, "orphan") ||
			includesToken(conflict.kind, "missing") ||
			payloadIdentifiesMissingResourceRelation(conflict);
		if (!looksLikeDanglingResource) return false;
		try {
			extractDanglingResourcePreview(conflict);
			return true;
		} catch {
			return false;
		}
	},
	materialize({
		conflict,
		projectId,
	}: {
		conflict: CrdtConflictRecord;
		projectId: string;
	}): MiniCutReviewItem {
		return materializeDanglingResourceReviewItem({ conflict, projectId });
	},
};

export { materializeDanglingResourceReviewItem };
export type { DanglingResourcePreview } from "./danglingResourcePreview";
