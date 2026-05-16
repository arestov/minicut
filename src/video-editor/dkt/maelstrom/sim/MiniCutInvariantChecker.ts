import { expect } from "vitest";
import type { MiniCutPeer } from "./createMiniCutCrdtSimulation";
import type { DeterministicMiniCutNetwork } from "./DeterministicMiniCutNetwork";

const metaCount = (model: { states?: Record<string, unknown> }, attrName: string): number =>
	Number(model.states?.[attrName] ?? 0);

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

export const expectUniqueVideoClipIds = (peer: MiniCutPeer) => {
	const clipIds = peer.readVideoClipIds();
	expect(new Set(clipIds).size).toBe(clipIds.length);
};

export const expectTimingConflictOpen = (peer: MiniCutPeer, clip: { states?: Record<string, unknown> }) => {
	expect(
		Math.max(
			metaCount(clip, "$meta$aggregates$crdt$clipTiming$open_conflicts_count"),
			metaCount(clip, "$meta$attrs$crdt$duration$open_conflicts_count"),
			metaCount(clip, "$meta$model$crdt$open_conflicts_count"),
		),
		`${peer.id} expected open timing conflict`,
	).toBeGreaterThan(0);
};