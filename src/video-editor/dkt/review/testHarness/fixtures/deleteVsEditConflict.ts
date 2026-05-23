import type { CrdtConflictRecord } from "../../types";

export const deleteVsEditConflictFixture: CrdtConflictRecord = {
	conflict_id: "conflict:delete-vs-edit",
	status: "open",
	kind: "structural_delete_with_concurrent_activity",
	node_id: "clip:2",
	model_name: "clip",
	aggregate: "clipLifecycle",
	payload: {
		deleted: { clipId: "clip:2" },
		edited: { start: 5, duration: 2 },
	},
	source_frame_id: 31,
	source_root_frame_id: 30,
	batch_id: "peer-b:batch:3",
	happened_at: 3,
};

