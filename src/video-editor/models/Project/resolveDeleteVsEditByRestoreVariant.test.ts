import { describe, expect, it } from "vitest";
import {
	reduceCommitDeleteVsEditRestoreVariant,
	reducePreserveDeleteAndArchiveIncomingEdit,
	reduceResolveDeleteVsEditByRestoreVariant,
} from "./actions";

const payload = {
	conflictId: "conflict:delete-vs-edit",
	reviewItemId: "review:conflict:delete-vs-edit",
	clipId: "clip:deleted",
	targetTrackId: "track:main",
	editedVariant: {
		clipAttrs: {
			name: "Remote edit",
			color: "#f59e0b",
			mediaKind: "video",
			start: 4,
			in: 1,
			duration: 3,
			fadeIn: 0.2,
			fadeOut: 0,
		},
	},
};

describe("resolveDeleteVsEditByRestoreVariant", () => {
	it("creates a clip and emits CRDT resolve after the artifact exists", () => {
		const result = reduceResolveDeleteVsEditByRestoreVariant(
			payload,
			Symbol("noop"),
			{ _node_id: "project:1" },
			{ _node_id: "track:main" },
		);

		expect(result).toMatchObject({
			clip: {
				attrs: {
					name: "Remote edit",
					start: 4,
					in: 1,
					duration: 3,
				},
				rels: {
					resource: null,
				},
				hold_ref_id: "restoredDeleteVsEditClip",
			},
			next: {
				clip: { use_ref_id: "restoredDeleteVsEditClip" },
				targetTrack: { _node_id: "track:main" },
				conflictId: "conflict:delete-vs-edit",
				reviewItemId: "review:conflict:delete-vs-edit",
				sourceConflictClipId: "clip:deleted",
				targetTrackId: "track:main",
			},
		});
	});

	it("does not emit CRDT resolve for invalid restore payloads", () => {
		const noop = Symbol("noop");

		expect(
			reduceResolveDeleteVsEditByRestoreVariant(
				{ ...payload, targetTrackId: "track:other" },
				noop,
				{ _node_id: "project:1" },
				{ _node_id: "track:main" },
			),
		).toBe(noop);
	});

	it("links the restored clip before forwarding CRDT resolve", () => {
		expect(
			reduceCommitDeleteVsEditRestoreVariant({
				clip: { _node_id: "clip:restored" },
				targetTrack: { _node_id: "track:main" },
				conflictId: "conflict:delete-vs-edit",
				reviewItemId: "review:conflict:delete-vs-edit",
				sourceConflictClipId: "clip:deleted",
				targetTrackId: "track:main",
			}),
		).toMatchObject({
			targetTracks: {
				clip: { _node_id: "clip:restored" },
				targetTrack: { _node_id: "track:main" },
			},
			crdtResolve: {
				conflict_id: "conflict:delete-vs-edit",
				decision: {
					action: "resolveDeleteVsEditByRestoreVariant",
					domain_result: {
						type: "deleted_variant_restored",
						restoredClipId: "clip:restored",
						targetTrackId: "track:main",
						sourceConflictClipId: "clip:deleted",
					},
				},
			},
		});
	});
});

describe("preserveDeleteAndArchiveIncomingEdit", () => {
	it("archives the edited variant and emits CRDT resolve", () => {
		const result = reducePreserveDeleteAndArchiveIncomingEdit(
			payload,
			Symbol("noop"),
			{ _node_id: "project:1" },
		);

		expect(result).toMatchObject({
			reviewArchiveEntry: {
				attrs: {
					archiveEntryId:
						"archive:review:conflict:delete-vs-edit:clip:deleted",
					conflictId: "conflict:delete-vs-edit",
					reviewItemId: "review:conflict:delete-vs-edit",
					projectId: "project:1",
					sourceConflictClipId: "clip:deleted",
					editedVariant: payload.editedVariant,
				},
				hold_ref_id: "deleteVsEditArchiveEntry",
			},
			crdtResolve: {
				conflict_id: "conflict:delete-vs-edit",
				decision: {
					action: "preserveDeleteAndArchiveIncomingEdit",
					domain_result: {
						type: "delete_preserved_edit_archived",
						sourceConflictClipId: "clip:deleted",
						archivedVariantId:
							"archive:review:conflict:delete-vs-edit:clip:deleted",
					},
				},
			},
		});
	});
});
