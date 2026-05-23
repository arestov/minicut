import { describe, expect, it } from "vitest";
import { bootDktModels } from "../../testingInit";
import { inspectReviewGraph } from "./inspectReviewGraph";
import { clipTimingConflictFixture } from "./fixtures/clipTimingConflict";

describe("inspectReviewGraph", () => {
	it("reads review projections through queryRel/queryAttr", async () => {
		const ctx = await bootDktModels();
		try {
			await ctx.lockToRead(async () => {
				await ctx.appModel.dispatch("handleCRDTConflict", {
					event_type: "crdt_conflict",
					projectId: "project:inspect",
					happened_at: 1,
					opened: [clipTimingConflictFixture],
					updated: [],
					acknowledged: [],
					resolved: [],
					previous: { [clipTimingConflictFixture.conflict_id]: null },
				});
			});

			const graph = await inspectReviewGraph(ctx);

			expect(graph.reviewSessions).toHaveLength(1);
			expect(graph.reviewSessions[0]).toMatchObject({
				modelName: "review_session",
				attrs: {
					projectId: "project:inspect",
					selectedReviewItemId: "review:conflict:clip-timing",
					openItemCount: 0,
				},
				items: [],
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
