import type {
	CrdtConflictStatus,
	MiniCutReviewItem,
	MiniCutReviewKind,
	MiniCutReviewObject,
	MiniCutReviewActionTarget,
} from "../types";
import type { ReviewGraphNodeSnapshot } from "../testHarness/inspectReviewGraph";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown, fallback = ""): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const asArray = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value as Value[]) : [];

const asKind = (value: unknown): MiniCutReviewKind =>
	value === "clip_timing" ||
	value === "dangling_resource" ||
	value === "delete_vs_edit" ||
	value === "track_order" ||
	value === "unknown"
		? value
		: "unknown";

const asStatus = (value: unknown): CrdtConflictStatus =>
	value === "acknowledged" || value === "resolved" ? value : "open";

export const reviewItemFromGraphNode = (
	node: ReviewGraphNodeSnapshot,
): MiniCutReviewItem => {
	const snapshot = isRecord(node.attrs.reviewItemSnapshot)
		? node.attrs.reviewItemSnapshot
		: node.attrs;
	const id = asString(
		snapshot.reviewItemId,
		asString(snapshot.id, asString(node.nodeId)),
	);
	const conflictId = asString(snapshot.conflictId, id);
	return {
		id,
		conflictId,
		projectId: asString(snapshot.projectId),
		kind: asKind(snapshot.kind),
		status: asStatus(snapshot.status),
		title: asString(snapshot.title, "CRDT conflict"),
		affectedObjects: asArray<MiniCutReviewObject>(snapshot.affectedObjects),
		preview: snapshot.preview ?? null,
		availableActions: asArray<string>(snapshot.availableActions),
		actionTargets: isRecord(snapshot.actionTargets)
			? (snapshot.actionTargets as Record<string, MiniCutReviewActionTarget>)
			: {},
		source:
			snapshot.source && typeof snapshot.source === "object"
				? (snapshot.source as MiniCutReviewItem["source"])
				: { conflictId },
	};
};