import { expect } from "vitest";
import type { MiniCutPeer } from "./createMiniCutCrdtSimulation";
import type { DeterministicMiniCutNetwork } from "./DeterministicMiniCutNetwork";

const metaCount = async (peer: MiniCutPeer, model: MiniCutPeer["project"], attrName: string): Promise<number> =>
	Number(await peer.ctx.queryAttr(model, attrName) ?? 0);

export const expectNoPendingNetwork = (network: DeterministicMiniCutNetwork) => {
	expect(network.pending()).toEqual([]);
};

export const expectNonNegativeCrdtMeta = (peer: MiniCutPeer) => {
	for (const model of [peer.project, peer.videoTrack, peer.audioTrack]) {
		for (const [attrName, value] of Object.entries(model.states ?? {})) {
			if (attrName.includes("$crdt$") && attrName.endsWith("_count")) {
				expect(Number(value), `${peer.id} ${attrName}`).toBeGreaterThanOrEqual(0);
			}
		}
	}
};

export const expectUniqueVideoClipIds = async (peer: MiniCutPeer) => {
	const clipIds = await peer.readVideoClipIds();
	expect(new Set(clipIds).size).toBe(clipIds.length);
};

export const expectTimingConflictOpen = async (peer: MiniCutPeer, clip: MiniCutPeer["project"]) => {
	expect(
		Math.max(
			await metaCount(peer, clip, "$meta$aggregates$crdt$clipTiming$open_conflicts_count"),
			await metaCount(peer, clip, "$meta$attrs$crdt$duration$open_conflicts_count"),
			await metaCount(peer, clip, "$meta$model$crdt$open_conflicts_count"),
		),
		`${peer.id} expected open timing conflict`,
	).toBeGreaterThan(0);
};
