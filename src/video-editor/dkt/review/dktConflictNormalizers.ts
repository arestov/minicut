import type { CrdtConflictRecord } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const payloadRecord = (conflict: Pick<CrdtConflictRecord, "payload">) =>
	isRecord(conflict.payload) ? conflict.payload : null;

export type StructuralDeleteRelationConflict = {
	ownerNodeId: string;
	relationName: string;
	itemNodeId: string;
};

export const readStructuralDeleteRelationConflict = (
	conflict: Pick<CrdtConflictRecord, "kind" | "payload">,
): StructuralDeleteRelationConflict | null => {
	if (conflict.kind !== "structural_delete_with_concurrent_activity") {
		return null;
	}
	const relation = payloadRecord(conflict)?.relation;
	if (!isRecord(relation) || relation.operation !== "delete") {
		return null;
	}
	const ownerNodeId = nonEmptyString(relation.owner_node_id);
	const relationName = nonEmptyString(relation.name);
	const itemNodeId = nonEmptyString(relation.item_node_id);
	return ownerNodeId && relationName && itemNodeId
		? { ownerNodeId, relationName, itemNodeId }
		: null;
};

export type DanglingRefConflict = {
	sourceNodeId: string;
	targetNodeId: string;
	fieldName: string;
	fieldId: string;
	policy: "prevent-delete";
};

export const readDanglingRefConflict = (
	conflict: Pick<CrdtConflictRecord, "kind" | "payload">,
): DanglingRefConflict | null => {
	if (conflict.kind !== "dangling_ref") {
		return null;
	}
	const ref = payloadRecord(conflict)?.ref;
	if (!isRecord(ref) || ref.policy !== "prevent-delete") {
		return null;
	}
	const sourceNodeId = nonEmptyString(ref.source_node_id);
	const targetNodeId = nonEmptyString(ref.target_node_id);
	const fieldName = nonEmptyString(ref.field_name);
	const fieldId = nonEmptyString(ref.field_id);
	return sourceNodeId && targetNodeId && fieldName && fieldId
		? {
				sourceNodeId,
				targetNodeId,
				fieldName,
				fieldId,
				policy: "prevent-delete",
			}
		: null;
};

export type SequenceMoveConflict = {
	ownerNodeId: string;
	relationName: string;
	itemNodeId: string;
	current: Record<string, unknown> | null;
	incoming: Record<string, unknown>;
	operation: string | null;
};

export const readSequenceMoveConflict = (
	conflict: Pick<CrdtConflictRecord, "kind" | "payload">,
): SequenceMoveConflict | null => {
	if (conflict.kind !== "sequence_move_vs_move") {
		return null;
	}
	const sequence = payloadRecord(conflict)?.sequence;
	if (!isRecord(sequence)) {
		return null;
	}
	const ownerNodeId = nonEmptyString(sequence.owner_node_id);
	const relationName = nonEmptyString(sequence.name);
	const itemNodeId = nonEmptyString(sequence.item_node_id);
	const current =
		sequence.current === null
			? null
			: isRecord(sequence.current)
				? sequence.current
				: undefined;
	const incoming = isRecord(sequence.incoming) ? sequence.incoming : null;
	if (!ownerNodeId || !relationName || !itemNodeId || current === undefined || !incoming) {
		return null;
	}
	return {
		ownerNodeId,
		relationName,
		itemNodeId,
		current,
		incoming,
		operation: nonEmptyString(sequence.operation),
	};
};

export type MvrAttrConflict = {
	nodeId: string;
	fieldName: string;
	alternatives: unknown[];
};

export const readMvrAttrConflict = (
	conflict: Pick<
		CrdtConflictRecord,
		"kind" | "node_id" | "field_name" | "payload"
	> & { alternatives?: unknown },
): MvrAttrConflict | null => {
	if (conflict.kind !== "mvr_alternatives") {
		return null;
	}
	const nodeId = nonEmptyString(conflict.node_id);
	const fieldName = nonEmptyString(conflict.field_name);
	const payload = payloadRecord(conflict);
	const alternatives = Array.isArray(payload?.alternatives)
		? payload.alternatives
		: Array.isArray(conflict.alternatives)
			? conflict.alternatives
			: null;
	return nodeId && fieldName && alternatives
		? { nodeId, fieldName, alternatives }
		: null;
};
