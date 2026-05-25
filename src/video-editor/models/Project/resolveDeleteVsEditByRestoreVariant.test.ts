import { describe, expect, it } from "vitest";
import {
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
					project: { _node_id: "project:1" },
					track: { _node_id: "track:main" },
				},
				hold_ref_id: "restoredDeleteVsEditClip",
			},
			targetTrackClips: { use_ref_id: "restoredDeleteVsEditClip" },
			crdtResolve: {
				conflict_id: "conflict:delete-vs-edit",
				decision: {
					action: "resolveDeleteVsEditByRestoreVariant",
					domain_result: {
						type: "deleted_variant_restored",
						restoredClipId: { use_ref_id: "restoredDeleteVsEditClip" },
						targetTrackId: "track:main",
						sourceConflictClipId: "clip:deleted",
					},
				},
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
});

describe("preserveDeleteAndArchiveIncomingEdit", () => {
	it("archives the edited variant and emits CRDT resolve", () => {
		const result = reducePreserveDeleteAndArchiveIncomingEdit(
			payload,
			Symbol("noop"),
		);

		expect(result).toMatchObject({
			reviewArchiveEntries: [
				{
					id: "archive:review:conflict:delete-vs-edit:clip:deleted",
					conflictId: "conflict:delete-vs-edit",
					reviewItemId: "review:conflict:delete-vs-edit",
					sourceConflictClipId: "clip:deleted",
					editedVariant: payload.editedVariant,
				},
			],
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
