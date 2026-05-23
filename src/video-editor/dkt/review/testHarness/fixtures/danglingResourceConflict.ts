import type { CrdtConflictRecord } from "../../types";

export const danglingResourceConflictFixture: CrdtConflictRecord = {
	conflict_id: "conflict:dangling-resource",
	status: "open",
	kind: "dangling_resource",
	node_id: "resource:1",
	model_name: "resource",
	field_kind: "rel",
	field_name: "resource",
	aggregate: "resourceLifecycle",
	payload: { resourceId: "resource:1", clipIds: ["clip:1"] },
	source_frame_id: 21,
	source_root_frame_id: 20,
	batch_id: "peer-b:batch:2",
	happened_at: 2,
};

