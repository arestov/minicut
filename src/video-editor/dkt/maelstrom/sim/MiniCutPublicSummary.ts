import type { MiniCutPeer } from "./createMiniCutCrdtSimulation";

const count = (model: { states?: Record<string, unknown> }, attrName: string): number =>
	Number(model.states?.[attrName] ?? 0);

export const readMiniCutPublicSummary = async (peers: MiniCutPeer[]) => {
	const peerSummaries = [];
	for (const peer of peers) {
		const clips = await peer.ctx.queryRel(peer.videoTrack, "clips");
		peerSummaries.push({
			peerId: peer.id,
			projectTitle: peer.readProjectTitle(),
			videoClipIds: peer.readVideoClipIds(),
			clips: clips.map((clip) => ({
				id: clip._node_id,
				start: peer.ctx.getAttr(clip, "start"),
				in: peer.ctx.getAttr(clip, "in"),
				duration: peer.ctx.getAttr(clip, "duration"),
				openTiming: count(clip, "$meta$aggregates$crdt$clipTiming$open_conflicts_count"),
				openModel: count(clip, "$meta$model$crdt$open_conflicts_count"),
			})),
		});
	}
	return peerSummaries;
};

export const normalizeMiniCutSummary = (summary: Awaited<ReturnType<typeof readMiniCutPublicSummary>>) =>
	summary.map((peer) => ({
		videoClipCount: peer.videoClipIds.length,
		clips: peer.clips.map((clip) => ({
			start: clip.start,
			in: clip.in,
			duration: clip.duration,
			openTiming: clip.openTiming,
			openModel: clip.openModel,
		})),
	}));