import type { CrdtConflictRecord } from "../../types";

export const danglingResourceConflictFixture: CrdtConflictRecord = {
	conflict_id: "opaque:dangling-resource",
	status: "open",
	kind: "dangling_ref",
	node_id: "resource:1",
	model_name: "resource",
	field_kind: "attr",
	field_name: "$meta$removed",
	aggregate: "resourceLifecycle",
	payload: {
		ref: {
			source_node_id: "clip:1",
			target_node_id: "resource:1",
			field_name: "resource",
			field_id: "Clip:rel:resource",
			policy: "prevent-delete",
		},
	},
	details: {
		resourceId: "resource:1",
		resourceName: "Interview missing.mov",
		resourceKind: "video",
		clipIds: ["clip:1"],
		missingUrl: "file:///offline/interview-missing.mov",
		lastKnownSource: { kind: "file", name: "interview-missing.mov" },
	},
	source_frame_id: 21,
	source_root_frame_id: 20,
	batch_id: "peer-b:batch:2",
	happened_at: 2,
};
