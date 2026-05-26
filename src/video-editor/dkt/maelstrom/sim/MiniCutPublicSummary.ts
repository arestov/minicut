import type { MiniCutPeer } from "./createMiniCutCrdtSimulation";

const count = async (peer: MiniCutPeer, model: MiniCutPeer["project"], attrName: string): Promise<number> =>
	Number(await peer.ctx.queryAttr(model, attrName) ?? 0);

export const readMiniCutPublicSummary = async (peers: MiniCutPeer[]) => {
	const peerSummaries = [];
	for (const peer of peers) {
		const clips = await peer.queryVideoClips();
		peerSummaries.push({
			peerId: peer.id,
			projectTitle: await peer.readProjectTitle(),
			videoClipIds: await peer.readVideoClipIds(),
			clips: await Promise.all(clips.map(async (clip) => ({
					id: clip._node_id,
					start: await peer.ctx.queryAttr(clip, "start"),
					in: await peer.ctx.queryAttr(clip, "in"),
					duration: await peer.ctx.queryAttr(clip, "duration"),
					openTiming: await count(peer, clip, "$meta$aggregates$crdt$clipTiming$open_conflicts_count"),
					openModel: await count(peer, clip, "$meta$model$crdt$open_conflicts_count"),
				}))),
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
