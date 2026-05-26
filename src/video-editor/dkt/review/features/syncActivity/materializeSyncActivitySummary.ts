import type {
	CrdtSyncPayload,
	MiniCutActivitySummary,
	MiniCutReviewObject,
} from "../../types";
import { summarizeActionTraceRoots } from "./actionTraceSummary";

const readString = (value: unknown, key: string): string | null =>
	value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
		? ((value as Record<string, string>)[key] as string)
		: null;

const objectFromRecord = (
	record: unknown,
	extras: Partial<MiniCutReviewObject> = {},
): MiniCutReviewObject => {
	const id =
		readString(record, "node_id") ??
		readString(record, "id") ??
		readString(record, "op_id") ??
		"unknown";
	const type =
		readString(record, "model_name") ??
		readString(record, "kind") ??
		readString(record, "type") ??
		"model";
	const label =
		readString(record, "name") ??
		readString(record, "field_name") ??
		readString(record, "field_id") ??
		undefined;
	return { type, id, ...(label ? { label } : null), ...extras };
};

const opKey = (record: unknown): string =>
	[
		readString(record, "op_id") ?? "",
		readString(record, "node_id") ?? readString(record, "id") ?? "",
		readString(record, "model_name") ?? "",
		readString(record, "field_name") ?? readString(record, "field_id") ?? "",
	].join("\u0000");

const titleForSummary = (payload: CrdtSyncPayload): string => {
	const peer = payload.origin_peer_id;
	if (payload.created_models.length > 0) {
		return `Imported changes from ${peer}`;
	}
	if (payload.tombstones.length > 0 && payload.ops.length === 0) {
		return `Deleted items from ${peer}`;
	}
	if (payload.ops.length > 0 || payload.rejected_ops.length > 0) {
		return `Timeline changes from ${peer}`;
	}
	return `Project changes from ${peer}`;
};

export const materializeSyncActivitySummary = ({
	payload,
	projectId,
}: {
	payload: CrdtSyncPayload;
	projectId: string;
}): MiniCutActivitySummary => {
	const acceptedUpdated = payload.ops.map((op) => objectFromRecord(op));
	const acceptedKeys = new Set(payload.ops.map(opKey));
	const hasOpenedConflictItem = payload.opened_conflict_ids.length > 0;
	const rejectedUpdated = hasOpenedConflictItem
		? []
		: payload.rejected_ops
				.filter((op) => !acceptedKeys.has(opKey(op)))
				.map((op) => objectFromRecord(op, { status: "rejected" }));

	return {
		id: `activity:${payload.batch_id}`,
		projectId,
		batchId: payload.batch_id,
		originPeerId: payload.origin_peer_id,
		title: titleForSummary(payload),
		created: payload.created_models.map((model) => objectFromRecord(model)),
		updated: [...acceptedUpdated, ...rejectedUpdated],
		deleted: payload.tombstones.map((tombstone) => objectFromRecord(tombstone)),
		rootFrames: summarizeActionTraceRoots(payload.action_trace),
		happenedAt: payload.happened_at,
		openedConflictIds: payload.opened_conflict_ids,
		updatedConflictIds: payload.updated_conflict_ids,
	};
};
