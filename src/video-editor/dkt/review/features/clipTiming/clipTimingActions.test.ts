import { describe, expect, it } from "vitest";
import { reduceParkIncomingVariantOnReviewTrack } from "./clipTimingActions";

describe("reduceParkIncomingVariantOnReviewTrack", () => {
	it("creates a disabled muted review track, duplicate clip, and CRDT resolve", () => {
		const result = reduceParkIncomingVariantOnReviewTrack(
			{
				conflictId: "conflict:clip",
				reviewItemId: "review:clip",
				clipId: "clip:1",
				variant: "incoming",
				timing: { start: 2, in: 1, duration: 3, fadeIn: 0, fadeOut: 0 },
			},
			"$noop",
			{ _node_id: "project:1" },
		);

		expect(result).toMatchObject({
			reviewTrack: {
				attrs: {
					name: "Incoming Review",
					enabled: false,
					muted: true,
					isVisible: true,
				},
				hold_ref_id: "incomingReviewTrack",
			},
			parkedClip: {
				attrs: {
					name: "Incoming timing variant",
					start: 2,
					in: 1,
					duration: 3,
				},
				rels: {
					track: { use_ref_id: "incomingReviewTrack" },
				},
				hold_ref_id: "parkedIncomingClip",
			},
			crdtResolve: {
				conflict_id: "conflict:clip",
				decision: {
					action: "parkIncomingVariantOnReviewTrack",
					review_item_id: "review:clip",
					domain_result: {
						type: "parked_variant",
						sourceClipId: "clip:1",
						variant: "incoming",
					},
				},
			},
		});
	});
});
