import { describe, expect, it } from "vitest";
import { replayCrdtReviewEvents } from "./replayCrdtReviewEvents";
import { clipTimingConflictFixture } from "./fixtures/clipTimingConflict";
import { syncBatchFixture } from "./fixtures/syncBatch";

describe("replayCrdtReviewEvents", () => {
	it("replays sync before conflict lifecycle into review session snapshots", () => {
		const result = replayCrdtReviewEvents({
			projectId: "project:1",
			syncPayloads: [syncBatchFixture],
			conflictPayloads: [
				{
					event_type: "crdt_conflict",
					happened_at: 2,
					opened: [clipTimingConflictFixture],
					updated: [],
					acknowledged: [],
					resolved: [],
					previous: { [clipTimingConflictFixture.conflict_id]: null },
				},
			],
		});

		expect(result.activitySummaries).toHaveLength(1);
		expect(result.items).toEqual([
			expect.objectContaining({
				conflictId: "conflict:clip-timing",
				kind: "clip_timing",
				source: expect.objectContaining({
					frameId: 11,
					rootFrameId: 10,
				}),
			}),
		]);
	});

	it("keeps resolved review items in session history", () => {
		const result = replayCrdtReviewEvents({
			projectId: "project:1",
			conflictPayloads: [
				{
					event_type: "crdt_conflict",
					happened_at: 2,
					opened: [],
					updated: [],
					acknowledged: [],
					resolved: [{ ...clipTimingConflictFixture, status: "resolved" }],
					previous: {
						[clipTimingConflictFixture.conflict_id]: clipTimingConflictFixture,
					},
				},
			],
		});

		expect(result.items).toEqual([
			expect.objectContaining({
				conflictId: "conflict:clip-timing",
				status: "resolved",
			}),
		]);
	});

	it("updates an opened item to resolved without creating a duplicate", () => {
		const result = replayCrdtReviewEvents({
			projectId: "project:1",
			conflictPayloads: [
				{
					event_type: "crdt_conflict",
					happened_at: 2,
					opened: [clipTimingConflictFixture],
					updated: [],
					acknowledged: [],
					resolved: [],
					previous: { [clipTimingConflictFixture.conflict_id]: null },
				},
				{
					event_type: "crdt_conflict",
					happened_at: 3,
					opened: [],
					updated: [],
					acknowledged: [],
					resolved: [{ ...clipTimingConflictFixture, status: "resolved" }],
					previous: {
						[clipTimingConflictFixture.conflict_id]: clipTimingConflictFixture,
					},
				},
			],
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toEqual(
			expect.objectContaining({
				conflictId: "conflict:clip-timing",
				status: "resolved",
			}),
		);
	});
});
