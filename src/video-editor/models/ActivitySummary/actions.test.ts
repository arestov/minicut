import { describe, expect, it } from "vitest";
import {
	materializeCrdtSyncSummary,
	reduceMaterializeSyncActivitySummary,
	updateCrdtSyncSummary,
} from "./actions";
import { syncBatchFixture } from "../../dkt/review/testHarness/fixtures/syncBatch";

describe("ActivitySummary actions", () => {
	it("materializes CRDT sync payloads as app-owned activity summaries", () => {
		expect(
			reduceMaterializeSyncActivitySummary(syncBatchFixture, "project:1"),
		).toMatchObject({
			attrs: {
				activitySummaryId: "activity:peer-b:batch:1",
				projectId: "project:1",
				batchId: "peer-b:batch:1",
				title: "Imported changes from peer-b",
			},
		});
	});

	it("exposes materialize and update reducers without conflict resolve commands", async () => {
		expect(materializeCrdtSyncSummary(syncBatchFixture, "project:1")).toMatchObject({
			attrs: {
				activitySummaryId: "activity:peer-b:batch:1",
			},
		});
		expect(updateCrdtSyncSummary(syncBatchFixture, "project:1")).toMatchObject({
			activitySummaryId: "activity:peer-b:batch:1",
			updated: [{ type: "clip", id: "clip:1", label: "start" }],
		});
		expect(
			Object.keys(
				(await import("./actions")) as Record<string, unknown>,
			).some((name) => name.toLowerCase().includes("resolve")),
		).toBe(false);
	});
});
