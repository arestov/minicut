import type { MiniCutPeer, createMiniCutCrdtSimulation } from "./createMiniCutCrdtSimulation";
import type { MiniCutTraceStep } from "./MiniCutScenarioDSL";
import { dispatchClipTimingResizeGesture } from "../../test/clipTimingGesture";

type Simulation = Awaited<ReturnType<typeof createMiniCutCrdtSimulation>>;

type TraceContext = {
	clipByPeer?: Partial<Record<MiniCutPeer["id"], MiniCutPeer["project"]>>;
};

const targetForStep = async (peer: MiniCutPeer, step: Extract<MiniCutTraceStep, { type: "dispatch" }>, ctx: TraceContext) => {
	if (step.target === "project") return peer.project;
	if (step.target === "videoTrack") return peer.videoTrack;
	return clipTargetForPeer(peer, ctx);
};

const ensureClipTargetCarriers = async (peer: MiniCutPeer, clip: MiniCutPeer["project"]) => {
	const start = await peer.ctx.queryAttr(clip, "start");
	const inPoint = await peer.ctx.queryAttr(clip, "in");
	const duration = await peer.ctx.queryAttr(clip, "duration");
	await peer.ctx.queryRel(clip, "resource");
	if (
		typeof start !== "number" ||
		typeof inPoint !== "number" ||
		typeof duration !== "number"
	) {
		throw new Error(`Trace target clip timing carrier is incomplete for peer ${peer.id}: ${JSON.stringify({
			clip: clip._node_id,
			start,
			in: inPoint,
			duration,
		})}`);
	}
};

const clipTargetForPeer = async (peer: MiniCutPeer, ctx: TraceContext) => {
	const clip = ctx.clipByPeer?.[peer.id];
	if (!clip) throw new Error(`Trace target clip was not provided for peer ${peer.id}`);
	await ensureClipTargetCarriers(peer, clip);
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
					await peer.dispatch(await targetForStep(peer, step, ctx), step.actionName, step.payload, step.meta);
					peer.flushOutbound();
					break;
				}
				case "clipTimingResizeGesture": {
					const peer = simulation.peer(step.peerId);
					const clip = await clipTargetForPeer(peer, ctx);
					await dispatchClipTimingResizeGesture(peer.ctx, clip, {
						edge: step.edge,
						delta: step.delta,
						batchId: step.batchId,
					});
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
