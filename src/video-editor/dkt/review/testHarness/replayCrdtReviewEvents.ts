import { materializeCRDTConflictReviewItem } from "../materializeCRDTConflictReviewItem";
import { materializeCRDTSyncSummary } from "../materializeCRDTSyncSummary";
import type {
	CrdtConflictLifecyclePayload,
	CrdtSyncPayload,
	MiniCutReviewSessionSnapshot,
} from "../types";

export const replayCrdtReviewEvents = ({
	projectId,
	syncPayloads = [],
	conflictPayloads = [],
}: {
	projectId: string;
	syncPayloads?: CrdtSyncPayload[];
	conflictPayloads?: CrdtConflictLifecyclePayload[];
}): MiniCutReviewSessionSnapshot => {
	const items = new Map<string, ReturnType<typeof materializeCRDTConflictReviewItem>>();
	const activitySummaries = syncPayloads.map((payload) =>
		materializeCRDTSyncSummary({ payload, projectId }),
	);

	for (const payload of conflictPayloads) {
		const records = [
			...payload.opened,
			...payload.updated,
			...payload.acknowledged,
			...payload.resolved,
		];
		for (const conflict of records) {
			const item = materializeCRDTConflictReviewItem({ conflict, projectId });
			items.set(item.id, item);
		}
	}

	return {
		projectId,
		items: [...items.values()],
		activitySummaries,
	};
};

