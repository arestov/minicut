import { describe, expect, it } from "vitest";
import { bootDktModels } from "../../dkt/testingInit";
import {
	reduceAcknowledgeReviewItem,
	reduceHandleCRDTConflict,
	reduceHandleCRDTSync,
	reduceSelectReviewItem,
} from "./actions";
import { clipTimingConflictFixture } from "../../dkt/review/testHarness/fixtures/clipTimingConflict";
import { danglingResourceConflictFixture } from "../../dkt/review/testHarness/fixtures/danglingResourceConflict";
import { syncBatchFixture } from "../../dkt/review/testHarness/fixtures/syncBatch";

describe("AppRoot review actions", () => {
	it("materializes CRDT sync hooks as activity summary creation payloads", () => {
		expect(reduceHandleCRDTSync(syncBatchFixture, "project:1")).toMatchObject({
			attrs: {
				projectId: "project:1",
				reviewSessionId: "review-session:project:1",
			},
			rels: {
				activitySummaries: [
					{
						attrs: {
							activitySummaryId: "activity:peer-b:batch:1",
							projectId: "project:1",
							batchId: "peer-b:batch:1",
						},
					},
				],
			},
		});
	});

	it("materializes CRDT sync hooks through the app-root DKT action", async () => {
		const ctx = await bootDktModels();
		try {
			await ctx.lockToRead(async () => {
				await ctx.appModel.dispatch("handleCRDTSync", syncBatchFixture);
			});

			const summaries = await ctx.queryRel(ctx.appModel, "activitySummary");
			expect(summaries).toHaveLength(1);
			expect(await ctx.queryAttr(summaries[0], "activitySummaryId")).toBe(
				"activity:peer-b:batch:1",
			);
			expect(await ctx.queryAttr(summaries[0], "projectId")).toBe("2");
		} finally {
			await ctx.close();
		}
	});

	it("materializes CRDT conflict lifecycle hooks as ReviewSession item payloads", () => {
		expect(
			reduceHandleCRDTConflict(
				{
					opened: [clipTimingConflictFixture],
					updated: [],
					acknowledged: [],
					resolved: [],
				},
				"project:1",
			),
		).toMatchObject({
			attrs: {
				projectId: "project:1",
				reviewSessionId: "review-session:project:1",
				status: "open",
				selectedReviewItemId: "review:conflict:clip-timing",
			},
			rels: {
				items: [
					{
						attrs: {
							reviewItemId: "review:conflict:clip-timing",
							kind: "clip_timing",
							status: "open",
						},
					},
				],
			},
		});
	});

	it("materializes every lifecycle conflict into the review session queue", () => {
		expect(
			reduceHandleCRDTConflict(
				{
					opened: [clipTimingConflictFixture],
					updated: [],
					acknowledged: [
						{ ...danglingResourceConflictFixture, status: "acknowledged" },
					],
					resolved: [{ ...clipTimingConflictFixture, status: "resolved" }],
				},
				"project:1",
			),
		).toMatchObject({
			rels: {
				items: [
					{
						attrs: {
							reviewItemId: "review:conflict:dangling-resource",
							status: "acknowledged",
						},
					},
					{
						attrs: {
							reviewItemId: "review:conflict:clip-timing",
							status: "resolved",
						},
					},
				],
			},
		});
	});

	it("selects review items on app state", () => {
		expect(reduceSelectReviewItem({ reviewItemId: "review:1" })).toEqual({
			activeReviewItemId: "review:1",
		});
	});

	it("builds acknowledge command payloads through the review command helper", () => {
		expect(
			reduceAcknowledgeReviewItem({
				conflict_id: "conflict:1",
				review_item_id: "review:1",
			}),
		).toEqual({
			conflict_id: "conflict:1",
			actor: "minicut",
			review_item_id: "review:1",
			action: "acknowledgeReviewItem",
		});
	});
});
