import { describe, expect, it } from "vitest";
import {
	reduceAcceptParkedClipOnReviewTrack,
	reduceParkIncomingVariantOnReviewTrack,
} from "./clipTimingActions";

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
			{
				_node_id: "clip:1",
				states: {
					name: "Intro",
					color: "#22c55e",
					mediaKind: "video",
					audio: { gain: 0.7, pan: -0.1 },
					opacity: { value: 0.8 },
					transform: {
						x: { value: 10 },
						y: { value: 20 },
						scale: { value: 1.2 },
						rotation: { value: 5 },
					},
				},
				rels: {
					resource: { _node_id: "resource:1" },
					text: { _node_id: "text:1" },
					effects: [{ _node_id: "effect:1" }],
				},
			},
		);

		expect(result).toMatchObject({
			reviewTrack: {
				attrs: {
					name: "Incoming Review - Intro",
					enabled: false,
					muted: true,
					isVisible: true,
				},
				rels: {
					project: { _node_id: "project:1" },
				},
				hold_ref_id: "incomingReviewTrack",
			},
			parkedClip: {
				attrs: {
					name: "Intro incoming timing",
					color: "#22c55e",
					mediaKind: "video",
					start: 2,
					in: 1,
					duration: 3,
					audio: { gain: 0.7, pan: -0.1 },
					opacity: { value: 0.8 },
					transform: {
						x: { value: 10 },
						y: { value: 20 },
						scale: { value: 1.2 },
						rotation: { value: 5 },
					},
				},
				rels: {
					resource: { _node_id: "resource:1" },
					text: { _node_id: "text:1" },
					effects: [{ _node_id: "effect:1" }],
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

	it("routes parked clip to the newly created review track owner rel", () => {
		expect(
			reduceAcceptParkedClipOnReviewTrack({
				clip: { _node_id: "clip:parked" },
				targetTrack: { _node_id: "track:review" },
			}),
		).toEqual({
			clip: { _node_id: "clip:parked" },
			targetTrack: { _node_id: "track:review" },
		});
	});

	it("does not create review track, clip, or CRDT resolve for invalid park payloads", () => {
		expect(
			reduceParkIncomingVariantOnReviewTrack(
				{
					conflictId: "conflict:clip",
					reviewItemId: "review:clip",
					clipId: "clip:1",
					timing: { start: 2, in: 1, duration: -1 },
				},
				"$noop",
				{ _node_id: "project:1" },
				{ _node_id: "clip:1" },
			),
		).toBe("$noop");
	});

	it("does not park when the routed source clip does not match the payload clip", () => {
		expect(
			reduceParkIncomingVariantOnReviewTrack(
				{
					conflictId: "conflict:clip",
					reviewItemId: "review:clip",
					clipId: "clip:1",
					timing: { start: 2, in: 1, duration: 3, fadeIn: 0, fadeOut: 0 },
				},
				"$noop",
				{ _node_id: "project:1" },
				{ _node_id: "clip:other" },
			),
		).toBe("$noop");
	});
});
