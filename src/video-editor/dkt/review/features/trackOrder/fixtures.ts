import type { CrdtConflictRecord } from "../../types";

export const trackOrderConflictFixture: CrdtConflictRecord = {
	conflict_id: "conflict:track-order",
	status: "open",
	kind: "ordered_membership_conflict",
	node_id: "project:1",
	model_name: "project",
	field_kind: "rel",
	field_name: "tracks",
	aggregate: "projectTracks",
	payload: {
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
