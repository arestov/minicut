import type { MiniCutPeer, createMiniCutCrdtSimulation } from "./createMiniCutCrdtSimulation";
import type { MiniCutTraceStep } from "./MiniCutScenarioDSL";

type Simulation = Awaited<ReturnType<typeof createMiniCutCrdtSimulation>>;

type TraceContext = {
	clipByPeer?: Partial<Record<MiniCutPeer["id"], MiniCutPeer["project"]>>;
};

const targetForStep = (peer: MiniCutPeer, step: Extract<MiniCutTraceStep, { type: "dispatch" }>, ctx: TraceContext) => {
	if (step.target === "project") return peer.project;
	if (step.target === "videoTrack") return peer.videoTrack;
	const clip = ctx.clipByPeer?.[peer.id];
	if (!clip) throw new Error(`Trace target clip was not provided for peer ${peer.id}`);
	return clip;
};

export const runMiniCutTrace = async (simulation: Simulation, steps: MiniCutTraceStep[], ctx: TraceContext = {}) => {
	for (const [index, step] of steps.entries()) {
		try {
			switch (step.type) {
				case "partition":
					simulation.network.partition(step.groupA, step.groupB);
					break;
				case "heal":
					simulation.network.heal();
					break;
				case "deliverAll":
					await simulation.network.deliverAll(step);
					break;
				case "replayDelivered":
					await simulation.network.replayDelivered(step.count);
					break;
				case "dispatch": {
					const peer = simulation.peer(step.peerId);
					await peer.dispatch(targetForStep(peer, step, ctx), step.actionName, step.payload, step.meta);
					peer.flushOutbound();
					break;
				}
			}
			await simulation.waitForIdle();
		} catch (error) {
			const details = JSON.stringify({ stepIndex: index, step, pending: simulation.network.pending() }, null, 2);
			throw new Error(`MiniCut maelstrom trace failed\n${details}\n${error instanceof Error ? error.stack : String(error)}`);
		}
	}
};