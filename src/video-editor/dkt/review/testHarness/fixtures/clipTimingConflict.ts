import type { CrdtConflictRecord } from "../../types";

export const clipTimingConflictFixture: CrdtConflictRecord = {
	conflict_id: "conflict:clip-timing",
	status: "open",
	kind: "mvr_alternatives",
	node_id: "clip:1",
	model_name: "clip",
	field_kind: "attr",
	field_name: "start",
	aggregate: "clipTiming",
	payload: {
		alternatives: [{ value: 0 }, { value: 2 }],
	},
	details: {
		minicut: {
			clipTiming: {
				current: { start: 0, in: 0, duration: 4 },
				incoming: { start: 2, in: 1, duration: 3 },
			},
		},
	},
	conflict_group_id: "frame:10",
	source_frame_id: 11,
	source_root_frame_id: 10,
	batch_id: "peer-b:batch:1",
	happened_at: 1,
};
