import { describe, expect, it } from "vitest";
import { crdtReviewResourceDeps } from "../crdtReviewResources";
import { replayCrdtReviewEvents } from "./replayCrdtReviewEvents";
import { syncBatchFixture } from "./fixtures/syncBatch";

describe("replay CRDT sync activity", () => {
	it("backfills activity summaries from stored sync batches by id", () => {
		const storedBatches = new Map([[syncBatchFixture.batch_id, syncBatchFixture]]);
		const batchId = "peer-b:batch:1";
		const storageKey = crdtReviewResourceDeps.syncBatchById.replace(
			"[:batch_id]",
			batchId,
		);
		const payload = storedBatches.get(batchId);

		expect(storageKey).toBe("$meta$crdt/sync-batch/peer-b:batch:1");
		expect(payload).toBeDefined();
		expect(
			replayCrdtReviewEvents({
				projectId: "project:1",
				syncPayloads: payload ? [payload] : [],
			}).activitySummaries,
		).toEqual([
			expect.objectContaining({
				id: "activity:peer-b:batch:1",
				created: [{ type: "clip", id: "clip:1" }],
			}),
		]);
	});

	it("does not emit conflict resolve commands from sync activity replay", () => {
		const result = replayCrdtReviewEvents({
			projectId: "project:1",
			syncPayloads: [syncBatchFixture],
		});

		expect(result.items).toEqual([]);
		expect(result.activitySummaries[0]?.updated).toEqual([
			{ type: "clip", id: "clip:1", label: "start" },
		]);
	});
});
