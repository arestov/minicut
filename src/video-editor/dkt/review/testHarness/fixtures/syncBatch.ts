import type { CrdtSyncPayload } from "../../types";

export const syncBatchFixture: CrdtSyncPayload = {
	event_type: "crdt_sync",
	batch_id: "peer-b:batch:1",
	origin_peer_id: "peer-b",
	runtime_transaction_id: "tx:1",
	intent: null,
	clock: null,
	created_models: [{ node_id: "clip:1", model_name: "clip" }],
	tombstones: [],
	ops: [{ op_id: "op:1", node_id: "clip:1", model_name: "clip", field_name: "start" }],
	action_trace: {
		trace_version: 2,
		frames: [{ frame_id: 10, parent_frame_id: null }],
		produced_ops: [{ frame_id: 10, op_id: "op:1" }],
		produced_creates: [{ frame_id: 10, node_id: "clip:1" }],
	},
	applied_ops: [{ op_id: "op:1" }],
	rejected_ops: [],
	opened_conflict_ids: [],
	updated_conflict_ids: [],
	resolved_conflict_ids: [],
	acknowledged_conflict_ids: [],
	touched_node_ids: ["clip:1"],
	touched_model_names: ["clip"],
	affected_scopes: [],
	happened_at: 1,
};

