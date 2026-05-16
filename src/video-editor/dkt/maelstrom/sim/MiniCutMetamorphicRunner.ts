import { expect } from "vitest";
import { createMiniCutTimelineFixture } from "../fixtures/createMiniCutTimelineFixture";
import { expectNoPendingNetwork, expectTimingConflictOpen } from "./MiniCutInvariantChecker";
import { network } from "./MiniCutScenarioDSL";
import { runMiniCutTrace } from "./MiniCutTraceRunner";
import { normalizeMiniCutSummary, readMiniCutPublicSummary } from "./MiniCutPublicSummary";
import { createMiniCutCrdtSimulation } from "./createMiniCutCrdtSimulation";
import type { MiniCutGeneratedTrace } from "./MiniCutSmallTraceGenerator";

type DeliveryVariant = {
	name: string;
	duplicate: boolean;
	reorder: boolean;
	seedOffset: number;
};

const variants: DeliveryVariant[] = [
	{ name: "ordered", duplicate: false, reorder: false, seedOffset: 0 },
	{ name: "duplicated-reordered", duplicate: true, reorder: true, seedOffset: 1000 },
];

export const runMiniCutMetamorphicTrace = async (trace: MiniCutGeneratedTrace) => {
	const normalizedSummaries = [];
	for (const variant of variants) {
		const sim = await createMiniCutCrdtSimulation({ peers: ["A", "B"] });
		const { clips } = await createMiniCutTimelineFixture([sim.peer("A"), sim.peer("B")]);

		await runMiniCutTrace(sim, [
			...trace.steps,
			network.deliverAll({
				duplicate: variant.duplicate,
				reorder: variant.reorder,
				seed: trace.seed + variant.seedOffset,
			}),
		], { clipByPeer: { A: clips[0], B: clips[1] } });

		expectTimingConflictOpen(sim.peer("A"), clips[0]);
		expectTimingConflictOpen(sim.peer("B"), clips[1]);
		expectNoPendingNetwork(sim.network);
		normalizedSummaries.push({
			variant: variant.name,
			summary: normalizeMiniCutSummary(await readMiniCutPublicSummary([sim.peer("A"), sim.peer("B")])),
		});
	}

	for (const item of normalizedSummaries.slice(1)) {
		expect(item.summary, `seed ${trace.seed} ${item.variant}`).toEqual(normalizedSummaries[0]?.summary);
	}
};