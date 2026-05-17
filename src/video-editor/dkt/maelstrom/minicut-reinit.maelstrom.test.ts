import { indexedDB } from "fake-indexeddb";
import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { describe, expect, it } from "vitest";
import { createMiniCutCrdtSimulation } from "./sim/createMiniCutCrdtSimulation";

describe("MiniCut maelstrom reinit steps", () => {
	it("continues a two-peer scenario after reinit in the middle", async () => {
		const simulation = await createMiniCutCrdtSimulation({
			peers: ["A", "B"],
			storage: (peerId) => ({
				type: "indexeddb",
				dbName: `minicut-maelstrom-reinit-${peerId}-${Date.now()}-${Math.random()
					.toString(36)
					.slice(2)}`,
				indexedDB,
			}),
		});
		const peerA = simulation.peer("A");
		const peerB = simulation.peer("B");
		for (const peer of [peerA, peerB]) {
			await peer.dispatch(peer.videoTrack, "addClip", {
				name: "maelstrom-reinit.webm",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 4,
			});
			peer.ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();
		}
		await simulation.waitForIdle();
		const clipA = (await peerA.ctx.queryRel(peerA.videoTrack, "clips"))[0];
		const initialClipB = (await peerB.ctx.queryRel(peerB.videoTrack, "clips"))[0];
		if (!clipA || !initialClipB) throw new Error("Expected clips");

		await peerA.dispatch(clipA, "trim", { edge: "start", delta: 1 });
		const opsA = (
			peerA.ctx.runtime.crdt_runtime?.testing?.drainOutbox?.() ?? []
		)
			.filter((op) => (op as { kind?: unknown }).kind === "attr")
			.map((op) => ({ ...(op as object), node_id: initialClipB._node_id }));
		const restartedBPre = await simulation.reinitPeer("B");
		const restartedClipBPre =
			(await restartedBPre.ctx.queryRel(restartedBPre.videoTrack, "clips"))[0] ??
			getModelById(restartedBPre.ctx.sessionRoot, String(initialClipB._node_id));
		if (!restartedClipBPre) throw new Error("Expected restored clip on peer B");
		await restartedBPre.ctx.runtime.crdt_runtime?.receiveCanonicalOps?.(
			restartedClipBPre,
			opsA,
		);
		await simulation.waitForIdle();

		const restartedB = simulation.peer("B");
		const clipB =
			(await restartedB.ctx.queryRel(restartedB.videoTrack, "clips"))[0] ??
			getModelById(restartedB.ctx.sessionRoot, String(initialClipB._node_id));
		if (!clipB) throw new Error("Expected restored clip on peer B");
		expect(restartedB.ctx.getAttr(clipB, "start")).toBe(1);
		expect(restartedB.ctx.getAttr(clipB, "duration")).toBe(3);

		await restartedB.dispatch(clipB, "trim", { edge: "end", delta: -1 });
		const opsB = (
			restartedB.ctx.runtime.crdt_runtime?.testing?.drainOutbox?.() ?? []
		)
			.filter((op) => (op as { kind?: unknown }).kind === "attr")
			.map((op) => ({ ...(op as object), node_id: clipA._node_id }));
		const restartedAPre = await simulation.reinitPeer("A");
		const restartedClipAPre =
			(await restartedAPre.ctx.queryRel(restartedAPre.videoTrack, "clips"))[0] ??
			getModelById(restartedAPre.ctx.sessionRoot, String(clipA._node_id));
		if (!restartedClipAPre) throw new Error("Expected restored clip on peer A");
		await restartedAPre.ctx.runtime.crdt_runtime?.receiveCanonicalOps?.(
			restartedClipAPre,
			opsB,
		);
		await simulation.waitForIdle();

		const restartedA = simulation.peer("A");
		const finalClipA =
			(await restartedA.ctx.queryRel(restartedA.videoTrack, "clips"))[0] ??
			getModelById(restartedA.ctx.sessionRoot, String(clipA._node_id));
		if (!finalClipA) throw new Error("Expected restored clip on peer A");
		expect(restartedA.ctx.getAttr(finalClipA, "start")).toBe(1);
		expect(restartedA.ctx.getAttr(finalClipA, "duration")).toBe(2);
	});
});
