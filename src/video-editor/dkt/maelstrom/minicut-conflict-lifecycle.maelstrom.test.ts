import { describe, expect, it } from "vitest";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import { createMiniCutTimelineFixture } from "./fixtures/createMiniCutTimelineFixture";
import { expectNoPendingNetwork, expectTimingConflictOpen } from "./sim/MiniCutInvariantChecker";
import { clipTimingGesture, network } from "./sim/MiniCutScenarioDSL";
import { runMiniCutTrace } from "./sim/MiniCutTraceRunner";
import { createMiniCutCrdtSimulation } from "./sim/createMiniCutCrdtSimulation";

const readOpenTimingConflictId = (runtime: unknown, clipId: unknown): string => {
	const conflicts = (runtime as {
		crdt_runtime?: {
			conflict_store?: {
				readConflicts?: (scope?: unknown) => Array<{ conflict_id?: unknown; status?: unknown }>;
			};
		};
	}).crdt_runtime?.conflict_store?.readConflicts?.({
		node_id: clipId,
		aggregate: "clipTiming",
		status: "open",
	}) ?? [];
	const conflictId = conflicts.find((conflict) => typeof conflict.conflict_id === "string")?.conflict_id;
	if (typeof conflictId !== "string") {
		throw new Error("Expected open clipTiming conflict id");
	}
	return conflictId;
};

describe("MiniCut maelstrom conflict lifecycle", () => {
	it("keeps invalid timing resolution local and clears meta after valid resolve", async () => {
		const sim = await createMiniCutCrdtSimulation({ peers: ["A", "B"] });
		const { clips } = await createMiniCutTimelineFixture([sim.peer("A"), sim.peer("B")]);
		const clipA = clips[0];
		const clipB = clips[1];

		await runMiniCutTrace(sim, [
			network.partition(["A"], ["B"]),
			clipTimingGesture("A").resizeEnd(-1, { batchId: "lifecycle:A:resize" }),
			clipTimingGesture("B").resizeEnd(-2, { batchId: "lifecycle:B:resize" }),
			network.heal(),
			network.deliverAll({ duplicate: true, reorder: true, seed: 13 }),
		], { clipByPeer: { A: clipA, B: clipB } });

		expectTimingConflictOpen(sim.peer("A"), clipA);
		const conflictId = readOpenTimingConflictId(sim.peer("A").ctx.runtime, clipA._node_id);
		const previousDuration = sim.peer("A").ctx.getAttr(clipA, "duration");

		await sim.peer("A").dispatch(
			clipA,
			"resolveClipTimingConflict",
			{ conflict_id: conflictId, start: 0, in: 0, duration: 0 },
			{
				crdt_resolution_attempt: {
					conflict_id: conflictId,
					aggregate: "clipTiming",
					model_id: clipA._node_id,
					model_name: "clip",
				},
			},
		);

		expect(sim.peer("A").ctx.getAttr(clipA, "duration")).toBe(previousDuration);
		expect(sim.peer("A").ctx.getAttr(clipA, "$meta$aggregates$crdt$clipTiming$last_resolution_error"))
			.toEqual(expect.objectContaining({ code: "duration_non_positive" }));
		expect(drainCrdtOutbox(sim.peer("A").ctx.runtime)).toEqual([]);

		await sim.peer("A").dispatch(
			clipA,
			"resolveClipTimingConflict",
			{ conflict_id: conflictId, start: 0, in: 0, duration: 3 },
			{
				crdt_resolution_attempt: {
					conflict_id: conflictId,
					aggregate: "clipTiming",
					model_id: clipA._node_id,
					model_name: "clip",
				},
			},
		);

		expect(sim.peer("A").ctx.getAttr(clipA, "duration")).toBe(3);
		expect(Number(sim.peer("A").ctx.getAttr(clipA, "$meta$aggregates$crdt$clipTiming$open_conflicts_count") ?? 0)).toBe(0);
		expect(sim.peer("A").ctx.getAttr(clipA, "$meta$aggregates$crdt$clipTiming$last_resolution_error") ?? null).toBeNull();
		await sim.network.replayDelivered(4);
		expect(Number(sim.peer("A").ctx.getAttr(clipA, "$meta$aggregates$crdt$clipTiming$open_conflicts_count") ?? 0)).toBe(0);
		expectNoPendingNetwork(sim.network);
	});
});
