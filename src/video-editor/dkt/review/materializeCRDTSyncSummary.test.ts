import { describe, expect, it } from "vitest";
import {
	materializeCRDTSyncSummary,
	summarizeActionTraceRoots,
} from "./materializeCRDTSyncSummary";
import { syncBatchFixture } from "./testHarness/fixtures/syncBatch";

describe("materializeCRDTSyncSummary", () => {
	it("materializes accepted sync facts without conflicts", () => {
		expect(
			materializeCRDTSyncSummary({
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

	it("groups nested action trace mappings by root frame", () => {
		expect(
			summarizeActionTraceRoots({
				trace_version: 2,
				frames: [
					{ frame_id: 1, parent_frame_id: null },
					{ frame_id: 2, parent_frame_id: 1 },
					{ frame_id: 3, parent_frame_id: null },
				],
				produced_ops: [
					{ frame_id: 2, op_id: "op:1" },
					{ frame_id: 3, op_id: "op:2" },
				],
				produced_creates: [{ frame_id: 2, node_id: "clip:1" }],
			}),
		).toEqual([
			{ frameId: 1, opCount: 1, createCount: 1 },
			{ frameId: 3, opCount: 1, createCount: 0 },
		]);
	});
});

