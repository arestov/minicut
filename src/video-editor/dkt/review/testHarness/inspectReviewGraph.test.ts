import { describe, expect, it } from "vitest";
import { bootDktModels } from "../../testingInit";
import { waitForProjectReviewGraph } from "./inspectReviewGraph";
import { clipTimingConflictFixture } from "./fixtures/clipTimingConflict";

describe("inspectReviewGraph", () => {
	it("reads review projections through queryRel/queryAttr", async () => {
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
			expect(graph.reviewSessions[0]).toMatchObject({
				modelName: "review_session",
				attrs: {
					projectId: project._node_id,
					selectedReviewItemId: "review:conflict:clip-timing",
					openItemCount: 1,
				},
				items: [
					expect.objectContaining({
						modelName: "review_item",
						attrs: expect.objectContaining({
							reviewItemId: "review:conflict:clip-timing",
							conflictId: "conflict:clip-timing",
							kind: "clip_timing",
							status: "open",
						}),
					}),
				],
			});
			expect(graph.rootReviewItems).toEqual([
				expect.objectContaining({
					modelName: "review_item",
					attrs: expect.objectContaining({
						reviewItemId: "review:conflict:clip-timing",
						conflictId: "conflict:clip-timing",
						kind: "clip_timing",
						status: "open",
					}),
				}),
			]);
		} finally {
			await ctx.close();
		}
	});
});
