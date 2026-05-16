import { describe, expect, it } from "vitest";
import { expectNoPendingNetwork, expectNonNegativeCrdtMeta, expectUniqueVideoClipIds } from "./sim/MiniCutInvariantChecker";
import { network, user } from "./sim/MiniCutScenarioDSL";
import { runMiniCutTrace } from "./sim/MiniCutTraceRunner";
import { createMiniCutCrdtSimulation } from "./sim/createMiniCutCrdtSimulation";

describe("MiniCut maelstrom deterministic network", () => {
	it("converges public project attrs after partition healing", async () => {
		const sim = await createMiniCutCrdtSimulation({ peers: ["A", "B"] });

		await runMiniCutTrace(sim, [
			network.partition(["A"], ["B"]),
			user("A").dispatch("renameProject", "Maelstrom title"),
			network.deliverAll(),
			network.heal(),
			network.deliverAll({ duplicate: true, reorder: true, seed: 7 }),
		]);

		expect(sim.peer("B").readProjectTitle()).toBe("Maelstrom title");
		expectNoPendingNetwork(sim.network);
		for (const peerId of ["A", "B"] as const) {
			expectNonNegativeCrdtMeta(sim.peer(peerId));
			expectUniqueVideoClipIds(sim.peer(peerId));
		}
	});

	it("keeps duplicate delivered packets idempotent", async () => {
		const sim = await createMiniCutCrdtSimulation({ peers: ["A", "B"] });

		await runMiniCutTrace(sim, [
			user("A").dispatch("renameProject", "Duplicate replay title"),
			network.deliverAll({ duplicate: true, reorder: true, seed: 11 }),
			network.replayDelivered(2),
		]);

		expect(sim.peer("B").readProjectTitle()).toBe("Duplicate replay title");
		expectNoPendingNetwork(sim.network);
	});
});