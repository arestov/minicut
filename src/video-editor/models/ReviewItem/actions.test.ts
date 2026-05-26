import { describe, expect, it } from "vitest";
import {
	reduceCreateReviewItem,
	reduceCreateManualTrackOrderSuggestionOnReviewItem,
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
				actionTargets: {},
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

	it("updates track order manual suggestion on the targeted review item", () => {
		const preview = {
			type: "track_order" as const,
			currentOrder: [
				{ trackId: "track:video", name: "Video", kind: "video" },
				{ trackId: "track:audio", name: "Audio", kind: "audio" },
			],
			incomingOrder: [
				{ trackId: "track:audio", name: "Audio", kind: "audio" },
				{ trackId: "track:video", name: "Video", kind: "video" },
			],
			movedTrackIds: ["track:video", "track:audio"],
		};

		expect(
			reduceCreateManualTrackOrderSuggestionOnReviewItem(
				{
					reviewItemId: "review:track-order",
					preview,
					trackIds: ["track:audio", "track:video"],
				},
				null,
				"review:track-order",
			),
		).toMatchObject({
			preview: {
				manualOrder: [
					{ trackId: "track:audio", name: "Audio", kind: "audio" },
					{ trackId: "track:video", name: "Video", kind: "video" },
				],
			},
		});
		expect(
			reduceCreateManualTrackOrderSuggestionOnReviewItem(
				{
					reviewItemId: "review:other",
					preview,
					trackIds: ["track:audio", "track:video"],
				},
				"noop",
				"review:track-order",
			),
		).toBe("noop");
	});
});
