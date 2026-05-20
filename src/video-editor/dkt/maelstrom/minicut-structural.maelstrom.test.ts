import { describe, expect, it } from "vitest";
import { createMiniCutTimelineFixture } from "./fixtures/createMiniCutTimelineFixture";
import { expectNoPendingNetwork } from "./sim/MiniCutInvariantChecker";
import { createMiniCutMaelstromProfiles } from "./sim/MiniCutMaelstromProfiles";
import { network, user } from "./sim/MiniCutScenarioDSL";
import { runMiniCutTrace } from "./sim/MiniCutTraceRunner";
import {
	createMiniCutCrdtSimulation,
	type MiniCutPeer,
} from "./sim/createMiniCutCrdtSimulation";

type ModelHandle = MiniCutPeer["project"];

const metaCount = async (peer: MiniCutPeer, model: ModelHandle, attrs: string[]): Promise<number> =>
	Math.max(
		0,
		...(await Promise.all(attrs.map(async (attrName) =>
			Number(await peer.ctx.queryAttr(model, attrName) ?? 0),
		))),
	);

const expectTimelineConflict = async (peer: MiniCutPeer, model: ModelHandle) => {
	expect(
		await metaCount(peer, model, [
			"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
			"$meta$rels$crdt$clips$open_conflicts_count",
			"$meta$model$crdt$open_conflicts_count",
		]),
	).toBeGreaterThan(0);
};

const createMultiClipFixture = async (
	sim: Awaited<ReturnType<typeof createMiniCutCrdtSimulation>>,
	clipCount: number,
) => {
	const source = sim.peer("A");
	for (let index = 0; index < clipCount; index += 1) {
		await source.dispatch(source.videoTrack, "addClip", {
			name: `maelstrom-clip-${index}.webm`,
			mediaKind: "video",
			start: index * 4,
			in: 0,
			duration: 4,
		});
		source.flushOutbound();
		await sim.network.deliverAll({ reorder: false });
		await sim.waitForIdle();
	}
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const counts = await Promise.all([sim.peer("A"), sim.peer("B")].map(async (peer) =>
			(await peer.queryVideoClips()).length,
		));
		if (counts.every((count) => count >= clipCount)) {
			break;
		}
		await sim.waitForIdle();
	}
	const peers = [sim.peer("A"), sim.peer("B")];
	const clips = (await Promise.all(peers.map((peer) => peer.queryVideoClips())))
		.map((peerClips) => [...peerClips].sort((left, right) =>
			String(left.states?.name ?? "").localeCompare(String(right.states?.name ?? "")),
		));
	for (let index = 0; index < clipCount; index += 1) {
		const id = clips[0]?.[index]?._node_id;
		if (!id || clips.some((peerClips) => peerClips[index]?._node_id !== id)) {
			throw new Error(`Expected matching clip ${index} across peers: ${JSON.stringify(clips.map((peerClips) =>
				peerClips.map((clip) => ({ id: clip._node_id, name: clip.states?.name, start: clip.states?.start })),
			))}`);
		}
	}
	return clips;
};

describe("MiniCut maelstrom structural conflicts", () => {
	for (const profile of createMiniCutMaelstromProfiles()) {
		it(`records delete vs effect edit as a timeline structural conflict with ${profile.name}`, async () => {
			const sim = await createMiniCutCrdtSimulation({
				peers: ["A", "B"],
				storage: profile.storage,
				unloadModels: profile.unloadModels,
			});
			const { clips } = await createMiniCutTimelineFixture(
				[sim.peer("A"), sim.peer("B")],
				{ syncFromPeer: sim.syncFromPeer, getPeer: sim.peer },
			);
			const clipA = clips[0];
			const clipB = clips[1];
			await sim.peer("A").dispatch(clipA, "addEffect", {
				kind: "blur",
				name: "Blur",
				params: { radius: 2 },
			});
			sim.peer("A").flushOutbound();
			await sim.network.deliverAll({ reorder: false });
			const effectA = (await sim.peer("A").ctx.queryRel(clipA, "effects"))[0];
			if (!effectA) throw new Error("Expected effect fixture");

			sim.network.partition(["A"], ["B"]);
			await sim.peer("A").dispatch(effectA, "setEffectParams", { params: { radius: 8 } });
			sim.peer("A").flushOutbound();
			await runMiniCutTrace(sim, [
				user("B").dispatch("removeSelf", undefined, { target: "clip" }),
				network.heal(),
				network.deliverAll({ duplicate: true, reorder: true, seed: 21 }),
			], { clipByPeer: { B: clipB } });

			await expectTimelineConflict(sim.peer("A"), sim.peer("A").videoTrack);
			expect((await sim.peer("A").ctx.queryRel(clipA, "effects"))[0]?._node_id).toBe(effectA._node_id);
			expectNoPendingNetwork(sim.network);
		});

		it(`records split vs delete as a timeline structural conflict with ${profile.name}`, async () => {
			const sim = await createMiniCutCrdtSimulation({
				peers: ["A", "B"],
				storage: profile.storage,
				unloadModels: profile.unloadModels,
			});
			const { clips } = await createMiniCutTimelineFixture(
				[sim.peer("A"), sim.peer("B")],
				{ syncFromPeer: sim.syncFromPeer, getPeer: sim.peer },
			);
			const clipA = clips[0];
			const clipB = clips[1];

			await runMiniCutTrace(sim, [
				network.partition(["A"], ["B"]),
				user("A").dispatch("splitSelfAt", { time: 2 }, { target: "clip" }),
				user("B").dispatch("removeSelf", undefined, { target: "clip" }),
				network.heal(),
				network.deliverAll({ duplicate: true, reorder: true, seed: 22 }),
			], { clipByPeer: { A: clipA, B: clipB } });

			await expectTimelineConflict(sim.peer("A"), sim.peer("A").videoTrack);
			expectNoPendingNetwork(sim.network);
		});

		it(`records concurrent semantic moves as timeline relation conflict with ${profile.name}`, async () => {
			const sim = await createMiniCutCrdtSimulation({
				peers: ["A", "B"],
				storage: profile.storage,
				unloadModels: profile.unloadModels,
			});
			const [clipsA, clipsB] = await createMultiClipFixture(sim, 3);

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
				await metaCount(sim.peer("A"), sim.peer("A").videoTrack, [
					"$meta$rels$crdt$clips$open_conflicts_count",
					"$meta$model$crdt$open_conflicts_count",
				]),
			).toBeGreaterThan(0);
			expect(
				sim.peer("A").ctx.runtime.crdt_runtime.conflict_store.readConflicts({
					aggregate: "timelineMembership",
				}),
			).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: "sequence_move_vs_move",
					field_kind: "rel",
					field_name: "clips",
					aggregate_anchor: {
						model_name: "track",
						field_kind: "rel",
						field_name: "clips",
					},
				}),
			]));
			expectNoPendingNetwork(sim.network);
		});
	}
});
