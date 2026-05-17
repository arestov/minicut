import {
	clipTimingGesture,
	network,
	type MiniCutTraceStep,
} from "./MiniCutScenarioDSL";

export type MiniCutGeneratedTrace = {
	seed: number;
	family: "timing_edit_vs_timing_edit";
	steps: MiniCutTraceStep[];
};

const timingDeltas = (seed: number) => {
	const first = -1 - (seed % 2);
	const second = -2 - (seed % 2);
	return { first, second };
};

export const generateMiniCutSmallTrace = (seed: number): MiniCutGeneratedTrace => {
	const { first, second } = timingDeltas(seed);
	return {
		seed,
		family: "timing_edit_vs_timing_edit",
		steps: [
			network.partition(["A"], ["B"]),
			clipTimingGesture("A").resizeEnd(first, {
				batchId: `generated:${seed}:A:resize`,
			}),
			clipTimingGesture("B").resizeEnd(second, {
				batchId: `generated:${seed}:B:resize`,
			}),
			network.heal(),
		],
	};
};
