import type {
	CrdtActionTrace,
	CrdtSyncPayload,
	MiniCutActivitySummary,
	MiniCutReviewObject,
} from "./types";

const readString = (value: unknown, key: string): string | null =>
	value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
		? ((value as Record<string, string>)[key] as string)
		: null;

const objectFromRecord = (record: unknown): MiniCutReviewObject => {
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
	return { type, id, ...(label ? { label } : null) };
};

const rootFrameId = (
	frameId: number,
	frameById: Map<number, CrdtActionTrace["frames"][number]>,
	seen = new Set<number>(),
): number => {
	if (seen.has(frameId)) {
		return frameId;
	}
	seen.add(frameId);
	const frame = frameById.get(frameId);
	const parent = frame?.parent_frame_id ?? null;
	return parent == null ? frameId : rootFrameId(parent, frameById, seen);
};

export const summarizeActionTraceRoots = (
	trace: CrdtActionTrace | null,
): Array<{ frameId: number; opCount: number; createCount: number }> => {
	if (!trace) {
		return [];
	}
	const frameById = new Map(trace.frames.map((frame) => [frame.frame_id, frame]));
	const byRoot = new Map<number, { frameId: number; opCount: number; createCount: number }>();
	const ensure = (frameId: number) => {
		const root = rootFrameId(frameId, frameById);
		const current = byRoot.get(root) ?? { frameId: root, opCount: 0, createCount: 0 };
		byRoot.set(root, current);
		return current;
	};
	for (const item of trace.produced_ops) {
		ensure(item.frame_id).opCount += 1;
	}
	for (const item of trace.produced_creates) {
		ensure(item.frame_id).createCount += 1;
	}
	return [...byRoot.values()].sort((a, b) => a.frameId - b.frameId);
};

const titleForSummary = (payload: CrdtSyncPayload): string => {
	const peer = payload.origin_peer_id;
	if (payload.created_models.length > 0) {
		return `Imported changes from ${peer}`;
	}
	if (payload.tombstones.length > 0 && payload.ops.length === 0) {
		return `Deleted items from ${peer}`;
	}
	if (payload.ops.length > 0) {
		return `Timeline changes from ${peer}`;
	}
	return `Project changes from ${peer}`;
};

export const materializeCRDTSyncSummary = ({
	payload,
	projectId,
}: {
	payload: CrdtSyncPayload;
	projectId: string;
}): MiniCutActivitySummary => ({
	id: `activity:${payload.batch_id}`,
	projectId,
	batchId: payload.batch_id,
	originPeerId: payload.origin_peer_id,
	title: titleForSummary(payload),
	created: payload.created_models.map(objectFromRecord),
	updated: payload.ops.map(objectFromRecord),
	deleted: payload.tombstones.map(objectFromRecord),
	rootFrames: summarizeActionTraceRoots(payload.action_trace),
	happenedAt: payload.happened_at,
});

