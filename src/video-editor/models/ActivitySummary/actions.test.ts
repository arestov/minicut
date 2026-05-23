import { describe, expect, it } from "vitest";
import { reduceMaterializeSyncActivitySummary } from "./actions";
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
});

