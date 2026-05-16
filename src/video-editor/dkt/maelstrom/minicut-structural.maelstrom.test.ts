import { describe, expect, it } from "vitest";
import { createMiniCutTimelineFixture } from "./fixtures/createMiniCutTimelineFixture";
import { expectNoPendingNetwork } from "./sim/MiniCutInvariantChecker";
import { network, user } from "./sim/MiniCutScenarioDSL";
import { runMiniCutTrace } from "./sim/MiniCutTraceRunner";
import { createMiniCutCrdtSimulation, type MiniCutPeer } from "./sim/createMiniCutCrdtSimulation";

type ModelHandle = MiniCutPeer["project"];

const metaCount = (model: ModelHandle, attrs: string[]): number =>
	Math.max(
		0,
		...attrs.map((attrName) => Number(model.states?.[attrName] ?? 0)),
	);

const expectTimelineConflict = (model: ModelHandle) => {
	expect(
		metaCount(model, [
			"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
			"$meta$rels$crdt$clips$open_conflicts_count",
			"$meta$model$crdt$open_conflicts_count",
		]),
	).toBeGreaterThan(0);
};

const createMultiClipFixture = async (
	peers: MiniCutPeer[],
	clipCount: number,
	simNetwork?: { deliverAll: (options?: { duplicate?: boolean; reorder?: boolean; seed?: number }) => Promise<unknown> },
) => {
	for (const peer of peers) {
		for (let index = 0; index < clipCount; index += 1) {
			await peer.dispatch(peer.videoTrack, "addClip", {
				name: `maelstrom-clip-${index}.webm`,
				mediaKind: "video",
				start: index * 4,
				in: 0,
				duration: 4,
			});
		}
	}
	peers[0]?.flushOutbound();
	await simNetwork?.deliverAll({ reorder: false });
	for (const peer of peers) {
		peer.ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();
	}
	const clips = await Promise.all(peers.map((peer) => peer.ctx.queryRel(peer.videoTrack, "clips")));
	for (let index = 0; index < clipCount; index += 1) {
		const id = clips[0]?.[index]?._node_id;
		if (!id || clips.some((peerClips) => peerClips[index]?._node_id !== id)) {
			throw new Error(`Expected matching clip ${index} across peers`);
		}
	}
	return clips;
};

describe("MiniCut maelstrom structural conflicts", () => {
	it("records delete vs effect edit as a timeline structural conflict", async () => {
		const sim = await createMiniCutCrdtSimulation({ peers: ["A", "B"] });
		const { clips } = await createMiniCutTimelineFixture([sim.peer("A"), sim.peer("B")]);
		const clipA = clips[0];
		const clipB = clips[1];
		for (const [peer, clip] of [[sim.peer("A"), clipA], [sim.peer("B"), clipB]] as const) {
			await peer.dispatch(clip, "addEffect", {
				kind: "blur",
				name: "Blur",
				params: { radius: 2 },
			});
			peer.ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();
		}
		const effectA = (await sim.peer("A").ctx.queryRel(clipA, "effects"))[0];
		if (!effectA) throw new Error("Expected effect fixture");

		await sim.peer("A").dispatch(effectA, "setEffectParams", { params: { radius: 8 } });
		sim.peer("A").ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();
		await runMiniCutTrace(sim, [
			user("B").dispatch("removeSelf", undefined, { target: "clip" }),
			network.deliverAll({ duplicate: true, reorder: true, seed: 21 }),
		], { clipByPeer: { B: clipB } });

		expectTimelineConflict(sim.peer("A").videoTrack);
		expect((await sim.peer("A").ctx.queryRel(clipA, "effects"))[0]?._node_id).toBe(effectA._node_id);
		expectNoPendingNetwork(sim.network);
	});

	it("records split vs delete as a timeline structural conflict", async () => {
		const sim = await createMiniCutCrdtSimulation({ peers: ["A", "B"] });
		const { clips } = await createMiniCutTimelineFixture([sim.peer("A"), sim.peer("B")]);
		const clipA = clips[0];
		const clipB = clips[1];

		await sim.peer("A").dispatch(clipA, "splitSelfAt", { time: 2 });
		sim.peer("A").ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();
		await runMiniCutTrace(sim, [
			user("B").dispatch("removeSelf", undefined, { target: "clip" }),
			network.deliverAll({ duplicate: true, reorder: true, seed: 22 }),
		], { clipByPeer: { B: clipB } });

		expectTimelineConflict(sim.peer("A").videoTrack);
		expectNoPendingNetwork(sim.network);
	});

	it("records concurrent semantic moves as relation conflict meta", async () => {
		const sim = await createMiniCutCrdtSimulation({ peers: ["A", "B"] });
		const [clipsA, clipsB] = await createMultiClipFixture([sim.peer("A"), sim.peer("B")], 3, sim.network);

		await runMiniCutTrace(sim, [
			network.partition(["A"], ["B"]),
			user("A").dispatch("moveClipWithinTrack", {
				clipId: clipsA[1]?._node_id,
				afterClipId: null,
			}, { target: "videoTrack" }),
			user("B").dispatch("moveClipWithinTrack", {
				clipId: clipsB[1]?._node_id,
				afterClipId: clipsB[2]?._node_id,
			}, { target: "videoTrack" }),
			network.heal(),
			network.deliverAll({ duplicate: true, reorder: true, seed: 23 }),
		]);

		expect(
			metaCount(sim.peer("A").videoTrack, [
				"$meta$rels$crdt$clips$open_conflicts_count",
				"$meta$model$crdt$open_conflicts_count",
			]),
		).toBeGreaterThan(0);
		expectNoPendingNetwork(sim.network);
	});
});