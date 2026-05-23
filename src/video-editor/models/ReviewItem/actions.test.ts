import { describe, expect, it } from "vitest";
import {
	reduceCreateReviewItem,
	reduceMaterializeReviewItemFromConflict,
} from "./actions";
import { clipTimingConflictFixture } from "../../dkt/review/testHarness/fixtures/clipTimingConflict";

describe("ReviewItem actions", () => {
	it("creates app-owned ReviewItem attrs from materialized items", () => {
		expect(
			reduceCreateReviewItem({
				id: "review:1",
				conflictId: "conflict:1",
				projectId: "project:1",
				kind: "unknown",
				status: "open",
				title: "CRDT conflict",
				affectedObjects: [],
				preview: { type: "unknown_conflict" },
				availableActions: [],
				source: { conflictId: "conflict:1" },
			}),
		).toMatchObject({
			attrs: {
				reviewItemId: "review:1",
				conflictId: "conflict:1",
				projectId: "project:1",
				kind: "unknown",
				status: "open",
			},
		});
	});

	it("materializes conflict records without storing the raw record as preview", () => {
		const result = reduceMaterializeReviewItemFromConflict(
			{ conflict: clipTimingConflictFixture },
			"project:1",
		);

		expect(result).toMatchObject({
			attrs: {
				reviewItemId: "review:conflict:clip-timing",
				conflictId: "conflict:clip-timing",
				kind: "clip_timing",
				source: {
					frameId: 11,
					rootFrameId: 10,
				},
			},
		});
		expect(result?.attrs.preview).not.toBe(clipTimingConflictFixture);
	});
});

