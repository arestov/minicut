import { describe, expect, it } from "vitest";
import { materializeTrackOrderReviewItem } from "./materializeTrackOrderReviewItem";
import { trackOrderConflictFixture } from "./fixtures";

describe("materializeTrackOrderReviewItem", () => {
	it("materializes project track conflicts as track_order review items", () => {
		const item = materializeTrackOrderReviewItem({
			conflict: trackOrderConflictFixture,
			projectId: "project:1",
		});

		expect(item).toMatchObject({
			id: "review:opaque:track-order",
			conflictId: "opaque:track-order",
			projectId: "project:1",
			kind: "track_order",
			title: "Track order changed while offline",
			affectedObjects: [
				{ type: "track", id: "track:video", label: "Video" },
				{ type: "track", id: "track:audio", label: "Audio" },
			],
			availableActions: [
				"resolveTrackOrderConflict",
				"preserveCurrentTrackOrder",
				"createManualTrackOrderSuggestion",
			],
			actionTargets: {
				resolveTrackOrderConflict: { type: "project", id: "project:1" },
				preserveCurrentTrackOrder: { type: "project", id: "project:1" },
				createManualTrackOrderSuggestion: {
					type: "project",
					id: "project:1",
				},
			},
			preview: {
				type: "track_order",
				currentOrder: [
					{ trackId: "track:video", name: "Video", kind: "video" },
					{ trackId: "track:audio", name: "Audio", kind: "audio" },
				],
				incomingOrder: [
					{ trackId: "track:audio", name: "Audio", kind: "audio" },
					{ trackId: "track:video", name: "Video", kind: "video" },
				],
			},
		});
	});

	it("does not recover sequence facts from sequence conflict ids", () => {
		expect(() =>
			materializeTrackOrderReviewItem({
				conflict: {
					...trackOrderConflictFixture,
					conflict_id:
						"sequence:move-vs-move:project:1:tracks:track:audio:root",
					payload: {},
					details: null,
				},
				projectId: "project:1",
			}),
		).toThrow("Unsupported track order conflict payload");
	});

	it("throws for records without enough order information", () => {
		expect(() =>
			materializeTrackOrderReviewItem({
				conflict: {
					...trackOrderConflictFixture,
					payload: { currentOrder: ["track:video"] },
					details: null,
				},
				projectId: "project:1",
			}),
		).toThrow("Unsupported track order conflict payload");
	});
});
