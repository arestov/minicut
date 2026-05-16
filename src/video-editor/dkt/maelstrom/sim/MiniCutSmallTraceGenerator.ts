import { network, user, type MiniCutTraceStep } from "./MiniCutScenarioDSL";

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
			user("A").dispatch("resize", { edge: "end", delta: first }, { target: "clip" }),
			user("B").dispatch("resize", { edge: "end", delta: second }, { target: "clip" }),
			network.heal(),
		],
	};
};