import type { CrdtConflictRecord } from "../../types";

export const trackOrderConflictFixture: CrdtConflictRecord = {
	conflict_id: "opaque:track-order",
	status: "open",
	kind: "sequence_move_vs_move",
	node_id: "project:1",
	model_name: "project",
	field_kind: "rel",
	field_name: "tracks",
	aggregate: "projectTracks",
	payload: {
		sequence: {
			owner_node_id: "project:1",
			name: "tracks",
			item_node_id: "track:audio",
			current: {
				item_id: "track:audio",
				after_id: "track:video",
			},
			incoming: {
				item_id: "track:audio",
				after_id: null,
			},
			operation: "move_vs_move",
		},
	},
	details: {
		tracks: [
			{ trackId: "track:video", name: "Video", kind: "video" },
			{ trackId: "track:audio", name: "Audio", kind: "audio" },
		],
		currentOrder: ["track:video", "track:audio"],
		incomingOrder: ["track:audio", "track:video"],
	},
	source_frame_id: 41,
	source_root_frame_id: 40,
	batch_id: "peer-b:batch:4",
	happened_at: 4,
};
