import { describe, expect, it } from "vitest";
import {
	reduceCommitParkEditedVariantOnReviewTrack,
	reduceParkEditedVariantOnReviewTrack,
} from "./actions";

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
			next: {
				clip: { use_ref_id: "parkedDeleteVsEditClip" },
				targetTrack: { use_ref_id: "deleteVsEditReviewTrack" },
				conflictId: "conflict:delete-vs-edit",
				reviewItemId: "review:conflict:delete-vs-edit",
				sourceConflictClipId: "clip:deleted",
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
			next: {
				targetTrack: { _node_id: "track:review", states: { trackRole: "incomingReview" } },
			},
		});
		expect(result).not.toHaveProperty("reviewTrack");
	});

	it("links the parked clip before forwarding CRDT resolve", () => {
		expect(
			reduceCommitParkEditedVariantOnReviewTrack({
				clip: { _node_id: "clip:parked" },
				targetTrack: { _node_id: "track:review" },
				conflictId: "conflict:delete-vs-edit",
				reviewItemId: "review:conflict:delete-vs-edit",
				sourceConflictClipId: "clip:deleted",
			}),
		).toEqual({
			targetTracks: {
				clip: { _node_id: "clip:parked" },
				targetTrack: { _node_id: "track:review" },
			},
			crdtResolve: {
				conflict_id: "conflict:delete-vs-edit",
				decision: {
					app: "minicut",
					decision_id:
						"parkEditedVariantOnReviewTrack:review:conflict:delete-vs-edit:conflict:delete-vs-edit",
					action: "parkEditedVariantOnReviewTrack",
					review_item_id: "review:conflict:delete-vs-edit",
					domain_result: {
						type: "edited_variant_parked",
						parkedClipId: "clip:parked",
						reviewTrackId: "track:review",
						sourceConflictClipId: "clip:deleted",
					},
				},
			},
		});
	});
});
