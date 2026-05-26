import { describe, expect, it } from "vitest";
import { expectNoPendingNetwork, expectNonNegativeCrdtMeta, expectUniqueVideoClipIds } from "./sim/MiniCutInvariantChecker";
import { createMiniCutMaelstromProfiles } from "./sim/MiniCutMaelstromProfiles";
import { network, user } from "./sim/MiniCutScenarioDSL";
import { runMiniCutTrace } from "./sim/MiniCutTraceRunner";
import { createMiniCutCrdtSimulation } from "./sim/createMiniCutCrdtSimulation";

describe("MiniCut maelstrom deterministic network", () => {
	for (const profile of createMiniCutMaelstromProfiles()) {
	it(`converges public project attrs after partition healing with ${profile.name}`, async () => {
		const sim = await createMiniCutCrdtSimulation({
			peers: ["A", "B"],
			storage: profile.storage,
			unloadModels: profile.unloadModels,
		});

		await runMiniCutTrace(sim, [
			network.partition(["A"], ["B"]),
			user("A").dispatch("renameProject", "Maelstrom title"),
			network.deliverAll(),
			network.heal(),
			network.deliverAll({ duplicate: true, reorder: true, seed: 7 }),
		]);

		await expect(sim.peer("B").readProjectTitle()).resolves.toBe("Maelstrom title");
		expectNoPendingNetwork(sim.network);
		for (const peerId of ["A", "B"] as const) {
			expectNonNegativeCrdtMeta(sim.peer(peerId));
			await expectUniqueVideoClipIds(sim.peer(peerId));
		}
	});

	it(`keeps duplicate delivered packets idempotent with ${profile.name}`, async () => {
		const sim = await createMiniCutCrdtSimulation({
			peers: ["A", "B"],
			storage: profile.storage,
			unloadModels: profile.unloadModels,
		});

		await runMiniCutTrace(sim, [
			user("A").dispatch("renameProject", "Duplicate replay title"),
			network.deliverAll({ duplicate: true, reorder: true, seed: 11 }),
			network.replayDelivered(2),
		]);

		await expect(sim.peer("B").readProjectTitle()).resolves.toBe("Duplicate replay title");
		expectNoPendingNetwork(sim.network);
	});
	}
});
