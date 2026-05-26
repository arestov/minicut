import { describe, expect, it } from "vitest";
import { reduceParkEditedVariantOnReviewTrack } from "./actions";

const payload = {
	conflictId: "conflict:delete-vs-edit",
	reviewItemId: "review:conflict:delete-vs-edit",
	clipId: "clip:deleted",
	editedVariant: {
		clipAttrs: {
			name: "Remote edit",
			mediaKind: "video",
			start: 4,
			in: 1,
			duration: 3,
		},
	},
};

describe("parkEditedVariantOnReviewTrack", () => {
	it("creates a disabled review track if missing and parks the edited clip", () => {
		const result = reduceParkEditedVariantOnReviewTrack(
			payload,
			Symbol("noop"),
			{ _node_id: "project:1" },
			[],
		);

		expect(result).toMatchObject({
			reviewTrack: {
				attrs: {
					name: "Incoming Review - Remote edit",
					trackRole: "incomingReview",
					enabled: false,
					visibleInPreview: false,
					muted: true,
				},
				hold_ref_id: "deleteVsEditReviewTrack",
			},
			reviewTracks: { use_ref_id: "deleteVsEditReviewTrack" },
			parkedClip: {
				attrs: {
					name: "Remote edit edited variant",
					start: 4,
					in: 1,
					duration: 3,
				},
				rels: {
					resource: null,
				},
				hold_ref_id: "parkedDeleteVsEditClip",
			},
			crdtResolve: {
				conflict_id: "conflict:delete-vs-edit",
				decision: {
					action: "parkEditedVariantOnReviewTrack",
					domain_result: {
						type: "edited_variant_parked",
						parkedClipId: { use_ref_id: "parkedDeleteVsEditClip" },
						reviewTrackId: { use_ref_id: "deleteVsEditReviewTrack" },
						sourceConflictClipId: "clip:deleted",
					},
				},
			},
		});
	});

	it("uses an existing incoming review track when present", () => {
		const result = reduceParkEditedVariantOnReviewTrack(
			payload,
			Symbol("noop"),
			{ _node_id: "project:1" },
			[{ _node_id: "track:review", states: { trackRole: "incomingReview" } }],
		);

		expect(result).toMatchObject({
			parkedClip: {
				rels: {
					resource: null,
				},
			},
			crdtResolve: {
				decision: {
					domain_result: {
						reviewTrackId: "track:review",
					},
				},
			},
		});
		expect(result).not.toHaveProperty("reviewTrack");
	});
});
