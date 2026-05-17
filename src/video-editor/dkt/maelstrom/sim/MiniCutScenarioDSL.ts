import type { MiniCutPeerId } from "./DeterministicMiniCutNetwork";

export type MiniCutTraceStep =
	| { type: "partition"; groupA: MiniCutPeerId[]; groupB: MiniCutPeerId[] }
	| { type: "heal" }
	| { type: "deliverAll"; duplicate?: boolean; reorder?: boolean; seed?: number }
	| { type: "replayDelivered"; count?: number }
	| { type: "dispatch"; peerId: MiniCutPeerId; target: "project" | "videoTrack" | "clip"; actionName: string; payload?: unknown; meta?: unknown }
	| { type: "clipTimingResizeGesture"; peerId: MiniCutPeerId; edge: "start" | "end"; delta: number; batchId: string };

export const network = {
	partition: (groupA: MiniCutPeerId[], groupB: MiniCutPeerId[]): MiniCutTraceStep => ({ type: "partition", groupA, groupB }),
	heal: (): MiniCutTraceStep => ({ type: "heal" }),
	deliverAll: (options: { duplicate?: boolean; reorder?: boolean; seed?: number } = {}): MiniCutTraceStep => ({ type: "deliverAll", ...options }),
	replayDelivered: (count = 1): MiniCutTraceStep => ({ type: "replayDelivered", count }),
};

export const user = (peerId: MiniCutPeerId) => ({
	dispatch(actionName: string, payload?: unknown, options: { target?: "project" | "videoTrack" | "clip"; meta?: unknown } = {}): MiniCutTraceStep {
		return {
			type: "dispatch",
			peerId,
			target: options.target ?? "project",
			actionName,
			payload,
			meta: options.meta,
		};
	},
});

export const clipTimingGesture = (peerId: MiniCutPeerId) => ({
	resizeEnd(delta: number, options: { batchId?: string } = {}): MiniCutTraceStep {
		return {
			type: "clipTimingResizeGesture",
			peerId,
			edge: "end",
			delta,
			batchId: options.batchId ?? `clip-timing:${peerId}:resize-end`,
		};
	},
});
