import { describe, expect, it } from "vitest";
import {
	frameRootIdForProducedOp,
	summarizeActionTraceRoots,
} from "./actionTraceSummary";

const trace = {
	trace_version: 2 as const,
	frames: [
		{ frame_id: 1, parent_frame_id: null },
		{ frame_id: 2, parent_frame_id: 1 },
		{ frame_id: 3, parent_frame_id: 2 },
		{ frame_id: 4, parent_frame_id: null },
	],
	produced_ops: [
		{ frame_id: 3, op_id: "op:nested" },
		{ frame_id: 4, op_id: "op:root" },
	],
	produced_creates: [{ frame_id: 2, node_id: "clip:1" }],
};

describe("syncActivity action trace summary", () => {
	it("groups produced ops and creates by root frame for nested frames", () => {
		expect(summarizeActionTraceRoots(trace)).toEqual([
			{ frameId: 1, opCount: 1, createCount: 1 },
			{ frameId: 4, opCount: 1, createCount: 0 },
		]);
	});

	it("finds root frame for produced ops and returns null for missing mappings", () => {
		expect(frameRootIdForProducedOp(trace, "op:nested")).toBe(1);
		expect(frameRootIdForProducedOp(trace, "op:missing")).toBeNull();
	});
});
