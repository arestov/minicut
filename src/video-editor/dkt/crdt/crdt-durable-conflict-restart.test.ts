import { indexedDB } from "fake-indexeddb";
import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { describe, expect, it } from "vitest";
import { createMiniCutTimelineFixture } from "../maelstrom/fixtures/createMiniCutTimelineFixture";
import { network } from "../maelstrom/sim/MiniCutScenarioDSL";
import { runMiniCutTrace } from "../maelstrom/sim/MiniCutTraceRunner";
import {
	createMiniCutCrdtSimulation,
	type MiniCutPeer,
} from "../maelstrom/sim/createMiniCutCrdtSimulation";

type Simulation = Awaited<ReturnType<typeof createMiniCutCrdtSimulation>>;
type ClipModel = MiniCutPeer["project"];

const createIndexedDbStorage = (testName: string) => (peerId: string) => ({
	type: "indexeddb" as const,
	dbName: `minicut-durable-conflict-${testName}-${peerId}-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2)}`,
	indexedDB,
});

const readOpenTimingConflicts = (peer: MiniCutPeer, clipId: string) =>
	peer.ctx.runtime.crdt_runtime?.conflict_store?.readConflicts?.({
		node_id: clipId,
		aggregate: "clipTiming",
		status: "open",
	}) ?? [];

const readOpenTimingConflictId = (peer: MiniCutPeer, clipId: string): string => {
	const conflictId = readOpenTimingConflicts(peer, clipId).find(
		(conflict) => typeof conflict.conflict_id === "string",
	)?.conflict_id;
	if (typeof conflictId !== "string") {
		throw new Error("Expected open durable timing conflict id");
	}
	return conflictId;
};

const findClip = async (
	peer: MiniCutPeer,
	clipId: string,
): Promise<ClipModel> => {
	const fromRel = (await peer.ctx.queryRel(peer.videoTrack, "clips")).find(
		(clip) => clip._node_id === clipId,
	);
	const clip =
		fromRel ?? (getModelById(peer.ctx.sessionRoot, clipId) as ClipModel | null);
	if (!clip) {
		throw new Error(`Expected durable clip ${clipId}`);
	}
	return clip;
};

const createDurableTimingConflict = async (
	testName: string,
): Promise<{ simulation: Simulation; clipA: ClipModel; clipB: ClipModel }> => {
	const simulation = await createMiniCutCrdtSimulation({
		peers: ["A", "B"],
		storage: createIndexedDbStorage(testName),
	});
	const { clips } = await createMiniCutTimelineFixture(
		[simulation.peer("A"), simulation.peer("B")],
		{ syncFromPeer: simulation.syncFromPeer, getPeer: simulation.peer },
	);
	const [clipA, clipB] = clips;
	if (!clipA || !clipB) {
		throw new Error("Expected durable timing fixture clips");
	}

	await runMiniCutTrace(
		simulation,
		[
			network.partition(["A"], ["B"]),
			{
				type: "dispatch",
				peerId: "A",
				target: "clip",
				actionName: "trim",
				payload: { edge: "end", delta: -1 },
			},
			{
				type: "dispatch",
				peerId: "B",
				target: "clip",
				actionName: "trim",
				payload: { edge: "end", delta: -2 },
			},
			network.heal(),
			network.deliverAll({ duplicate: true, reorder: true, seed: 17 }),
		],
		{ clipByPeer: { A: clipA, B: clipB } },
	);

	expect(readOpenTimingConflicts(simulation.peer("A"), String(clipA._node_id)))
		.toEqual([
			expect.objectContaining({
				node_id: clipA._node_id,
				field_name: "duration",
				aggregate_anchor: {
					model_name: "clip",
					field_kind: "attr",
					field_name: "start",
				},
				status: "open",
			}),
		]);

	return { simulation, clipA, clipB };
};

describe("MiniCut durable CRDT conflict restart", () => {
	it("keeps an open timing conflict open after IndexedDB restart", async () => {
		const { simulation, clipA } = await createDurableTimingConflict("open");
		const clipId = String(clipA._node_id);

		const restartedA = await simulation.reinitPeer("A");
		const restoredClipA = await findClip(restartedA, clipId);

		expect(readOpenTimingConflicts(restartedA, clipId)).toEqual([
			expect.objectContaining({
				node_id: restoredClipA._node_id,
				field_name: "duration",
				aggregate_anchor: {
					model_name: "clip",
					field_kind: "attr",
					field_name: "start",
				},
				status: "open",
			}),
		]);
	});

	it("keeps a resolved timing conflict resolved after IndexedDB restart", async () => {
		const { simulation, clipA } = await createDurableTimingConflict("resolved");
		const clipId = String(clipA._node_id);
		const conflictId = readOpenTimingConflictId(simulation.peer("A"), clipId);

		await simulation.peer("A").dispatch(
			clipA,
			"resolveClipTimingConflict",
			{ conflict_id: conflictId, start: 0, in: 0, duration: 3 },
			{
				crdt_resolution_attempt: {
					conflict_id: conflictId,
					aggregate: "clipTiming",
					model_id: clipId,
					model_name: "clip",
				},
			},
		);

		expect(readOpenTimingConflicts(simulation.peer("A"), clipId)).toEqual([]);

		const restartedA = await simulation.reinitPeer("A");
		await findClip(restartedA, clipId);

		expect(readOpenTimingConflicts(restartedA, clipId)).toEqual([]);
		expect(
			restartedA.ctx.runtime.crdt_runtime?.conflict_store?.readConflicts?.({
				node_id: clipId,
				aggregate: "clipTiming",
			}) ?? [],
		).toEqual([
			expect.objectContaining({
				conflict_id: conflictId,
				status: "resolved",
			}),
		]);
	});

	it("keeps failed timing resolution attempt meta durable across IndexedDB restart", async () => {
		const { simulation, clipA } = await createDurableTimingConflict("failed");
		const clipId = String(clipA._node_id);
		const conflictId = readOpenTimingConflictId(simulation.peer("A"), clipId);

		await simulation.peer("A").dispatch(
			clipA,
			"resolveClipTimingConflict",
			{ conflict_id: conflictId, start: 0, in: 0, duration: 0 },
			{
				crdt_resolution_attempt: {
					conflict_id: conflictId,
					aggregate: "clipTiming",
					model_id: clipId,
					model_name: "clip",
				},
			},
		);

		expect(
			await simulation.peer("A").ctx.queryAttr(
				clipA,
				"$meta$aggregates$crdt$clipTiming$last_resolution_error",
			),
		).toEqual(expect.objectContaining({ code: "duration_non_positive" }));

		const restartedA = await simulation.reinitPeer("A");
		const restoredClipA = await findClip(restartedA, clipId);

		expect(readOpenTimingConflicts(restartedA, clipId)).toHaveLength(1);
		expect(
			await restartedA.ctx.queryAttr(
				restoredClipA,
				"$meta$aggregates$crdt$clipTiming$last_resolution_error",
			),
		).toEqual(expect.objectContaining({ code: "duration_non_positive" }));
	});
});
