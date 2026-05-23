import { describe, expect, it } from "vitest";
import { bootDktModels } from "../../testingInit";
import {
	inspectProjectReviewGraph,
	waitForProjectReviewGraph,
} from "./inspectReviewGraph";
import { clipTimingConflictFixture } from "./fixtures/clipTimingConflict";

describe("inspectProjectReviewGraph", () => {
	it("flattens project-owned review session items for state inspection", async () => {
		const ctx = await bootDktModels();
		try {
			await ctx.lockToRead(async () => {
				await ctx.appModel.dispatch("handleCRDTConflict", {
					event_type: "crdt_conflict",
					happened_at: 1,
					opened: [clipTimingConflictFixture],
					updated: [],
					acknowledged: [],
					resolved: [],
					previous: { [clipTimingConflictFixture.conflict_id]: null },
				});
			});
			const project = (await ctx.queryRel(ctx.appModel, "project"))[0];
			if (!project) {
				throw new Error("Expected project");
			}

			const graph = await waitForProjectReviewGraph(
				ctx,
				project,
				(snapshot) => snapshot.items.length === 1,
			);

			expect(graph.reviewSessions).toHaveLength(1);
			expect(graph.items).toEqual([
				expect.objectContaining({
					modelName: "review_item",
					attrs: expect.objectContaining({
						kind: "clip_timing",
						status: "open",
					}),
				}),
			]);
			expect((await inspectProjectReviewGraph(ctx, project)).openItemCount).toBe(1);
		} finally {
			await ctx.close();
		}
	});
});
