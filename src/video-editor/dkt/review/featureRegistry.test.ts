import { describe, expect, it } from "vitest";
import { findReviewFeature, reviewFeatureRegistry } from "./featureRegistry";
import { materializeCRDTConflictReviewItem } from "./materializeCRDTConflictReviewItem";
import { clipTimingConflictFixture } from "./testHarness/fixtures/clipTimingConflict";
import { danglingResourceConflictFixture } from "./testHarness/fixtures/danglingResourceConflict";
import { deleteVsEditConflictFixture } from "./testHarness/fixtures/deleteVsEditConflict";
import { trackOrderConflictFixture } from "./testHarness/fixtures/trackOrderConflict";
import type { CrdtConflictRecord } from "./types";

describe("reviewFeatureRegistry", () => {
	it("registers product review feature slices", () => {
		expect(reviewFeatureRegistry.map((feature) => feature.kind)).toEqual([
			"clip_timing",
			"dangling_resource",
			"delete_vs_edit",
			"track_order",
		]);
	});

	it("classifies known CRDT conflict records", () => {
		expect(findReviewFeature(clipTimingConflictFixture)?.kind).toBe("clip_timing");
		expect(findReviewFeature(danglingResourceConflictFixture)?.kind).toBe(
			"dangling_resource",
		);
		expect(findReviewFeature(deleteVsEditConflictFixture)?.kind).toBe(
			"delete_vs_edit",
		);
		expect(findReviewFeature(trackOrderConflictFixture)?.kind).toBe("track_order");
	});

	it("keeps unknown conflicts out of the registry and materializes them explicitly", () => {
		const conflict: CrdtConflictRecord = {
			conflict_id: "conflict:unknown",
			status: "open",
			kind: "domain_specific_future_conflict",
			node_id: "node:1",
			model_name: "future",
			source_frame_id: 12,
			source_root_frame_id: 10,
		};

		expect(findReviewFeature(conflict)).toBeUndefined();
		expect(
			materializeCRDTConflictReviewItem({ conflict, projectId: "project:1" }),
		).toMatchObject({
			id: "review:conflict:unknown",
			kind: "unknown",
			preview: {
				type: "unknown_conflict",
				conflictId: "conflict:unknown",
			},
			source: {
				conflictId: "conflict:unknown",
				frameId: 12,
				rootFrameId: 10,
			},
		});
	});
});

