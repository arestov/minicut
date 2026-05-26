import { describe, expect, it } from "vitest";
import { createMiniCutTimelineFixture } from "./fixtures/createMiniCutTimelineFixture";
import { createMiniCutMaelstromProfiles } from "./sim/MiniCutMaelstromProfiles";
import { createMiniCutCrdtSimulation } from "./sim/createMiniCutCrdtSimulation";

describe("MiniCut maelstrom reinit steps", () => {
	for (const profile of createMiniCutMaelstromProfiles()) {
		it(`continues a two-peer scenario after reinit in the middle with ${profile.name}`, async () => {
			const simulation = await createMiniCutCrdtSimulation({
				peers: ["A", "B"],
				storage: profile.storage,
				unloadModels: profile.unloadModels,
			});
			const peerA = simulation.peer("A");
			const { clips } = await createMiniCutTimelineFixture(
				[simulation.peer("A"), simulation.peer("B")],
				{ syncFromPeer: simulation.syncFromPeer, getPeer: simulation.peer },
			);
			const clipA = clips[0];
			const initialClipB = clips[1];
			if (!clipA || !initialClipB) throw new Error("Expected clips");

			await peerA.dispatch(clipA, "trim", { edge: "start", delta: 1 });
			peerA.flushOutbound();
			await simulation.reinitPeer("B");
			await simulation.network.deliverAll({ reorder: false });
			await simulation.waitForIdle();

			const restartedB = simulation.peer("B");
			const clipB = (await restartedB.queryVideoClips())
				.find((clip) => clip._node_id === initialClipB._node_id);
			if (!clipB) throw new Error("Expected restored clip on peer B");
			expect(await restartedB.ctx.queryAttr(clipB, "start")).toBe(1);
			expect(await restartedB.ctx.queryAttr(clipB, "duration")).toBe(3);

			await restartedB.dispatch(clipB, "trim", { edge: "end", delta: -1 });
			restartedB.flushOutbound();
			await simulation.reinitPeer("A");
			await simulation.network.deliverAll({ reorder: false });
			await simulation.waitForIdle();

			const restartedA = simulation.peer("A");
			const finalClipA = (await restartedA.queryVideoClips())
				.find((clip) => clip._node_id === clipA._node_id);
			if (!finalClipA) throw new Error("Expected restored clip on peer A");
			expect(await restartedA.ctx.queryAttr(finalClipA, "start")).toBe(1);
			expect(await restartedA.ctx.queryAttr(finalClipA, "duration")).toBe(2);
		});
	}
});
