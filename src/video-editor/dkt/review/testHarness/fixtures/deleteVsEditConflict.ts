import type { CrdtConflictRecord } from "../../types";

export const deleteVsEditConflictFixture: CrdtConflictRecord = {
	conflict_id: "conflict:delete-vs-edit",
	status: "open",
	kind: "structural_delete_with_concurrent_activity",
	node_id: "clip:2",
	model_name: "clip",
	aggregate: "clipLifecycle",
	payload: {
		deleted: {
			clipId: "clip:2",
			resourceId: "resource:7",
			deletedAt: 3,
			peerId: "peer-a",
		},
		edited: {
			clipAttrs: {
				name: "Edited remote clip",
				color: "#f59e0b",
				mediaKind: "video",
				start: 5,
				in: 1,
				duration: 2,
				fadeIn: 0.25,
				fadeOut: 0,
			},
			resourceAttrs: {
				resourceId: "resource:7",
				name: "Remote source.mov",
				kind: "video",
				url: "minicut://resource/7",
				mime: "video/quicktime",
				duration: 12,
			},
			effectAttrs: [{ name: "Brightness", amount: 0.2 }],
			timing: { start: 5, in: 1, duration: 2, fadeIn: 0.25, fadeOut: 0 },
		},
	},
	conflict_group_id: "group:delete-vs-edit",
	source_frame_id: 31,
	source_root_frame_id: 30,
	batch_id: "peer-b:batch:3",
	origin_peer_id: "peer-b",
	happened_at: 3,
};
