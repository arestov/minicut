import { describe, expect, it } from "vitest";
import { extractClipTimingPreview } from "./features/clipTiming";
import { extractTrackOrderPreview } from "./features/trackOrder";
import { materializeDanglingResourceReviewItem } from "./features/danglingResource";
import { materializeDeleteVsEditReviewItem } from "./features/deleteVsEdit";
import { clipTimingConflictFixture } from "./testHarness/fixtures/clipTimingConflict";
import { danglingResourceConflictFixture } from "./testHarness/fixtures/danglingResourceConflict";
import { deleteVsEditConflictFixture } from "./testHarness/fixtures/deleteVsEditConflict";
import { trackOrderConflictFixture } from "./testHarness/fixtures/trackOrderConflict";

describe("strict MiniCut review conflict contracts", () => {
	it("rejects legacy clip timing variants outside details.minicut", () => {
		expect(() =>
			extractClipTimingPreview({
				...clipTimingConflictFixture,
				payload: {
					current: { start: 0, in: 0, duration: 4 },
					incoming: { start: 2, in: 1, duration: 3 },
				},
				details: null,
			}),
		).toThrow("Clip timing conflict requires typed timing MVR payload");
	});

	it("rejects legacy track order arrays outside details.minicut", () => {
		expect(() =>
			extractTrackOrderPreview({
				...trackOrderConflictFixture,
				details: {
					tracks: [{ trackId: "track:audio", name: "Audio", kind: "audio" }],
					currentOrder: ["track:audio"],
					incomingOrder: ["track:audio"],
				},
			}),
		).toThrow("Track order conflict requires MiniCut preview details");
	});

	it("rejects legacy dangling resource ids outside details.minicut", () => {
		expect(() =>
			materializeDanglingResourceReviewItem({
				conflict: {
					...danglingResourceConflictFixture,
					payload: {
						resourceId: "resource:1",
						affectedClipIds: ["clip:1"],
					},
					details: null,
				},
				projectId: "project:1",
			}),
		).toThrow("Dangling resource conflict requires typed resource ref payload");
	});

	it("rejects legacy delete-vs-edit variants outside details.minicut", () => {
		expect(() =>
			materializeDeleteVsEditReviewItem({
				conflict: {
					...deleteVsEditConflictFixture,
					payload: {
						deleted: { clip_id: "clip:2", track_id: "track:main" },
						edited: { attrs: { name: "Legacy edited clip" } },
					},
					details: null,
				},
				projectId: "project:1",
			}),
		).toThrow("Delete-vs-edit conflict requires typed clips relation payload");
	});
});
