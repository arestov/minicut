import { describe, expect, it } from "vitest";
import { materializeCRDTConflictReviewItem } from "./materializeCRDTConflictReviewItem";
import { clipTimingConflictFixture } from "./testHarness/fixtures/clipTimingConflict";

describe("review type contract", () => {
	it("does not store raw conflict records as review preview", () => {
		const item = materializeCRDTConflictReviewItem({
			conflict: clipTimingConflictFixture,
			projectId: "project:1",
		});

		expect(item.preview).not.toBe(clipTimingConflictFixture);
		expect(item.preview).toMatchObject({
			type: "clip_timing",
			conflictId: clipTimingConflictFixture.conflict_id,
		});
	});

	it("copies frame provenance from DKT conflict records", () => {
		expect(
			materializeCRDTConflictReviewItem({
				conflict: clipTimingConflictFixture,
				projectId: "project:1",
			}).source,
		).toEqual({
			conflictId: "conflict:clip-timing",
			conflictGroupId: "frame:10",
			syncBatchId: "peer-b:batch:1",
			frameId: 11,
			rootFrameId: 10,
		});
	});
});

