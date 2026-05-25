import { describe, expect, it } from "vitest";
import { reduceResolveClipTimingConflict } from "./actions";

describe("reduceResolveClipTimingConflict", () => {
	const clip = { _node_id: "clip:1" };

	it("chooses current timing and emits a CRDT resolve command", () => {
		const result = reduceResolveClipTimingConflict(
			{
				conflictId: "conflict:1",
				reviewItemId: "review:conflict:1",
				selectedVariant: "current",
				start: 0,
				in: 0,
				duration: 4,
				fadeIn: 0.5,
				fadeOut: 0.25,
			},
			clip,
		);

		expect(result).toMatchObject({
			start: 0,
			in: 0,
			duration: 4,
			fadeIn: 0.5,
			fadeOut: 0.25,
			crdtResolve: {
				conflict_id: "conflict:1",
				decision: {
					action: "resolveClipTimingConflict",
					review_item_id: "review:conflict:1",
					domain_result: {
						clipId: "clip:1",
						selectedVariant: "current",
						start: 0,
						in: 0,
						duration: 4,
						fadeIn: 0.5,
						fadeOut: 0.25,
					},
				},
			},
		});
	});

	it("chooses incoming timing and emits a CRDT resolve command", () => {
		const result = reduceResolveClipTimingConflict(
			{
				conflictId: "conflict:1",
				reviewItemId: "review:conflict:1",
				selectedVariant: "incoming",
				start: 2,
				in: 1,
				duration: 3,
			},
			clip,
		);

		expect(result).toMatchObject({
			start: 2,
			in: 1,
			duration: 3,
			fadeIn: 0,
			fadeOut: 0,
			crdtResolve: {
				conflict_id: "conflict:1",
				decision: {
					domain_result: {
						selectedVariant: "incoming",
						start: 2,
						in: 1,
						duration: 3,
					},
				},
			},
		});
	});

	it("rejects invalid timing without a CRDT resolve command", () => {
		expect(
			reduceResolveClipTimingConflict(
				{
					conflictId: "conflict:1",
					reviewItemId: "review:conflict:1",
					start: 0,
					in: 0,
					duration: 1,
					fadeIn: 0.75,
					fadeOut: 0.75,
				},
				clip,
			),
		).toBeNull();
	});

	it("rejects missing review item id without a CRDT resolve command", () => {
		expect(
			reduceResolveClipTimingConflict(
				{
					conflictId: "conflict:1",
					selectedVariant: "incoming",
					start: 0,
					in: 0,
					duration: 3,
				},
				clip,
			),
		).toBeNull();
	});
});
