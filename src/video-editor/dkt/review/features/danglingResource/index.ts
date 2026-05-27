import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { readDanglingRefConflict } from "../../dktConflictNormalizers";
import { extractDanglingResourcePreview } from "./danglingResourcePreview";
import { materializeDanglingResourceReviewItem } from "./materializeDanglingResourceReviewItem";

const includesToken = (value: string | null | undefined, token: string) =>
	typeof value === "string" && value.toLowerCase().includes(token);

const payloadIdentifiesMissingResourceRelation = (
	conflict: CrdtConflictRecord,
): boolean => {
	const danglingRef = readDanglingRefConflict(conflict);
	if (danglingRef?.fieldName === "resource") return true;
	if (conflict.field_kind !== "rel") return false;
	return includesToken(conflict.field_name, "resource");
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
