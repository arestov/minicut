import { describe, expect, it } from "vitest";
import { bootDktModels } from "../../dkt/testingInit";
import {
	reduceAcknowledgeReviewItem,
	reduceHandleCRDTConflict,
	reduceHandleCRDTConflictGraph,
	reduceHandleCRDTSync,
	reduceSelectReviewItem,
	resolveReviewProjectIdHint,
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

	it("attributes a sync batch to the project owning a touched node, not the first project", () => {
		const projects = [
			{ _node_id: "project:first", children_models: { tracks: [], resources: [] } },
			{
				_node_id: "project:second",
				children_models: {
					resources: [],
					tracks: [
						{ _node_id: "track:1", children_models: { clips: [{ _node_id: "clip:1" }] } },
					],
				},
			},
		];

		expect(
			resolveReviewProjectIdHint(syncBatchFixture, "project:first", projects),
		).toBe("project:second");
		expect(
			resolveReviewProjectIdHint(
				{ ...syncBatchFixture, touched_node_ids: ["unknown:1"] },
				"project:first",
				projects,
			),
		).toBe("project:first");
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
							reviewItemId: "review:opaque:dangling-resource",
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

	it("carries the conflict resolution into existing review items on lifecycle updates", () => {
		const resolution = {
			decision_id: "decision:1",
			domain_result: { variant: "current" },
		};
		const result = reduceHandleCRDTConflictGraph(
			{
				opened: [],
				updated: [],
				acknowledged: [],
				resolved: [
					{ ...clipTimingConflictFixture, status: "resolved", resolution },
				],
			},
			"project:1",
			[],
			[],
			["review:conflict:clip-timing"],
		);

		expect(result?.updateReviewItems).toEqual([
			expect.objectContaining({
				id: "review:conflict:clip-timing",
				status: "resolved",
				resolution,
			}),
		]);
	});

	it("enriches bare MVR clip timing conflicts from clip graph state", () => {
		const result = reduceHandleCRDTConflictGraph(
			{
				opened: [
					{
						conflict_id: "opaque:clip-timing",
						status: "open",
						kind: "mvr_alternatives",
						node_id: "clip:1",
						model_name: "clip",
						field_kind: "attr",
						field_name: "duration",
						payload: { alternatives: [5, 8] },
					},
				],
				updated: [],
				acknowledged: [],
				resolved: [],
			},
			"project:1",
			[],
			[
				{
					_node_id: "clip:1",
					states: {
						start: 12,
						in: 3,
						duration: 5,
						fadeIn: 0.25,
						fadeOut: 0.5,
					},
				},
			],
			[],
		);

		expect(result?.reviewItems?.[0].attrs.preview).toMatchObject({
			current: { start: 12, in: 3, duration: 5, fadeIn: 0.25, fadeOut: 0.5 },
			incoming: { start: 12, in: 3, duration: 8, fadeIn: 0.25, fadeOut: 0.5 },
			fields: ["duration"],
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
