import { materializeCRDTSyncSummary } from "../../dkt/review/materializeCRDTSyncSummary";
import type { CrdtSyncPayload, MiniCutActivitySummary } from "../../dkt/review/types";

const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

export const activitySummaryAttrsFromSummary = (
	summary: MiniCutActivitySummary,
) => ({
	activitySummaryId: summary.id,
	projectId: summary.projectId,
	batchId: summary.batchId,
	originPeerId: summary.originPeerId,
	title: summary.title,
	created: summary.created,
	updated: summary.updated,
	deleted: summary.deleted,
	rootFrames: summary.rootFrames,
	happenedAt: summary.happenedAt,
	openedConflictIds: summary.openedConflictIds ?? [],
	updatedConflictIds: summary.updatedConflictIds ?? [],
});

export const reduceCreateActivitySummary = (payload: unknown) => {
	const summary = asObject<MiniCutActivitySummary>(payload);
	if (!summary || !asString(summary.id) || !asString(summary.batchId)) {
		return null;
	}
	return {
		attrs: activitySummaryAttrsFromSummary(summary),
	};
};

export const reduceMaterializeSyncActivitySummary = (
	payload: unknown,
	projectIdHint: unknown,
) => {
	const value = asObject<{ payload?: unknown; projectId?: unknown }>(payload);
	const syncPayload = asObject<CrdtSyncPayload>(value?.payload ?? payload);
	const projectId = asString(value?.projectId) ?? asString(projectIdHint);
	if (!syncPayload || !asString(syncPayload.batch_id) || !projectId) {
		return null;
	}
	return reduceCreateActivitySummary(
		materializeCRDTSyncSummary({ payload: syncPayload, projectId }),
	);
};

export const materializeCrdtSyncSummary = reduceMaterializeSyncActivitySummary;

export const updateCrdtSyncSummary = (
	payload: unknown,
	projectIdHint: unknown,
) => reduceMaterializeSyncActivitySummary(payload, projectIdHint)?.attrs ?? null;
