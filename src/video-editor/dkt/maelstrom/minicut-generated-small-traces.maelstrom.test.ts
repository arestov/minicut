import { describe, it } from "vitest";
import { runMiniCutMetamorphicTrace } from "./sim/MiniCutMetamorphicRunner";
import { generateMiniCutSmallTrace } from "./sim/MiniCutSmallTraceGenerator";

const DEFAULT_SEEDS = [1, 2, 3, 4];
const HEAVY_SEEDS = Array.from({ length: 16 }, (_item, index) => index + 1);

describe("MiniCut maelstrom generated small traces", () => {
	const seeds = process.env.MINICUT_CRDT_HEAVY_MAELSTROM === "1" ? HEAVY_SEEDS : DEFAULT_SEEDS;

	for (const seed of seeds) {
		it.skip(`keeps timing conflict summaries stable across delivery variants seed=${seed}`, async () => {
			// TODO: enable once shared snapshot bootstrap carries CRDT sidecar
			// baseline for generated clip fixtures. Keeping this skipped avoids
			// reintroducing alias-map based same-id fixtures.
			await runMiniCutMetamorphicTrace(generateMiniCutSmallTrace(seed));
		});
	}
});
