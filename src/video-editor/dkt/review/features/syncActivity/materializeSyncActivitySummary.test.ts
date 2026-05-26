import { describe, expect, it } from "vitest";
import { syncBatchFixture } from "../../testHarness/fixtures/syncBatch";
import { materializeSyncActivitySummary } from "./materializeSyncActivitySummary";

describe("materializeSyncActivitySummary", () => {
	it("creates ActivitySummary for sync batches without conflicts", () => {
		expect(
			materializeSyncActivitySummary({
				payload: syncBatchFixture,
				projectId: "project:1",
			}),
		).toMatchObject({
			id: "activity:peer-b:batch:1",
			projectId: "project:1",
			batchId: "peer-b:batch:1",
			originPeerId: "peer-b",
			title: "Imported changes from peer-b",
			created: [{ type: "clip", id: "clip:1" }],
			updated: [{ type: "clip", id: "clip:1", label: "start" }],
			deleted: [],
			rootFrames: [{ frameId: 10, opCount: 1, createCount: 1 }],
		});
	});

	it("materializes tombstones and field ops as deleted and updated entries", () => {
		const summary = materializeSyncActivitySummary({
			projectId: "project:1",
			payload: {
				...syncBatchFixture,
				created_models: [],
				tombstones: [{ node_id: "clip:gone", model_name: "clip" }],
				ops: [
					{
						op_id: "op:effect",
						node_id: "effect:1",
						model_name: "effect",
						field_name: "amount",
					},
				],
			},
		});

		expect(summary.title).toBe("Timeline changes from peer-b");
		expect(summary.updated).toEqual([
			{ type: "effect", id: "effect:1", label: "amount" },
		]);
		expect(summary.deleted).toEqual([{ type: "clip", id: "clip:gone" }]);
	});

	it("shows rejected ops when no opened conflict item represents them", () => {
		const summary = materializeSyncActivitySummary({
			projectId: "project:1",
			payload: {
				...syncBatchFixture,
				created_models: [],
				ops: [],
				rejected_ops: [
					{
						op_id: "op:rejected",
						node_id: "clip:1",
						model_name: "clip",
						field_name: "duration",
					},
				],
			},
		});

		expect(summary.updated).toEqual([
			{
				type: "clip",
				id: "clip:1",
				label: "duration",
				status: "rejected",
			},
		]);
	});

	it("does not duplicate rejected ops that opened conflict review items", () => {
		const summary = materializeSyncActivitySummary({
			projectId: "project:1",
			payload: {
				...syncBatchFixture,
				created_models: [],
				ops: [],
				rejected_ops: [{ op_id: "op:rejected", node_id: "clip:1" }],
				opened_conflict_ids: ["conflict:clip:1"],
			},
		});

		expect(summary.updated).toEqual([]);
		expect(summary.openedConflictIds).toEqual(["conflict:clip:1"]);
	});
});
