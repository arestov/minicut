import type { CrdtConflictRecord, MiniCutReviewItem } from "../../types";
import { readDanglingRefConflict } from "../../dktConflictNormalizers";
import { readMiniCutConflictDetails } from "../../minicutConflictEnrichment";
import { extractDanglingResourcePreview } from "./danglingResourcePreview";
import { materializeDanglingResourceReviewItem } from "./materializeDanglingResourceReviewItem";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const danglingResourceFeature = {
	kind: "dangling_resource" as const,
	actions: ["resolveDanglingResourceByRelink", "keepOfflinePlaceholder"],
	canMaterialize(conflict: CrdtConflictRecord): boolean {
		const danglingRef = readDanglingRefConflict(conflict);
		if (danglingRef?.fieldName !== "resource") return false;
		if (!isRecord(readMiniCutConflictDetails(conflict).danglingResource)) {
			return false;
		}
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
