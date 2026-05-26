import type { CrdtConflictRecord, CrdtSyncBatch } from "../types";

export const createFakeDktReviewRuntime = () => {
	const conflicts = new Map<string, CrdtConflictRecord>();
	const batches = new Map<string, CrdtSyncBatch>();
	const lifecyclePayloads: unknown[] = [];
	const syncPayloads: unknown[] = [];

	return {
		putConflict(record: CrdtConflictRecord) {
			conflicts.set(record.conflict_id, record);
		},
		putBatch(batch: CrdtSyncBatch) {
			batches.set(batch.batch_id, batch);
		},
		readConflict(conflictId: string) {
			return conflicts.get(conflictId) ?? null;
		},
		readBatch(batchId: string) {
			return batches.get(batchId) ?? null;
		},
		recordSyncPayload(payload: unknown) {
			syncPayloads.push(payload);
		},
		recordConflictPayload(payload: unknown) {
			lifecyclePayloads.push(payload);
		},
		syncPayloads,
		lifecyclePayloads,
	};
};

