import type { MiniCutPeer } from "../sim/createMiniCutCrdtSimulation";

export const createMiniCutTimelineFixture = async (peers: MiniCutPeer[]) => {
	for (const peer of peers) {
		await peer.dispatch(peer.videoTrack, "addClip", {
			name: "maelstrom-fixture.webm",
			mediaKind: "video",
			start: 0,
			in: 0,
			duration: 4,
		});
		peer.flushOutbound();
	}
	for (const peer of peers) {
		peer.ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();
	}
	const clips = await Promise.all(peers.map((peer) => peer.ctx.queryRel(peer.videoTrack, "clips")));
	const firstClipId = clips[0]?.[0]?._node_id;
	if (!firstClipId || clips.some((peerClips) => peerClips[0]?._node_id !== firstClipId)) {
		throw new Error("Expected matching maelstrom fixture clip ids across peers");
	}
	return {
		clipId: firstClipId,
		clips: clips.map((peerClips) => peerClips[0]),
	};
};