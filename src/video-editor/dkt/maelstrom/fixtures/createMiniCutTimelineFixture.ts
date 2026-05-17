import type { MiniCutPeer } from "../sim/createMiniCutCrdtSimulation";

export const createMiniCutTimelineFixture = async (
	peers: MiniCutPeer[],
	options?: {
		sourcePeerId?: MiniCutPeer["id"];
		syncFromPeer?: (sourceId: MiniCutPeer["id"], targetIds?: MiniCutPeer["id"][]) => Promise<void>;
		getPeer?: (id: MiniCutPeer["id"]) => MiniCutPeer;
	},
) => {
	const sourcePeerId = options?.sourcePeerId ?? peers[0]?.id;
	const sourcePeer = peers.find((peer) => peer.id === sourcePeerId) ?? peers[0];
	if (!sourcePeer) throw new Error("Expected at least one maelstrom peer");

	if (options?.syncFromPeer) {
		await sourcePeer.dispatch(sourcePeer.videoTrack, "addClip", {
			name: "maelstrom-fixture.webm",
			mediaKind: "video",
			start: 0,
			in: 0,
			duration: 4,
		});
		await options.syncFromPeer(sourcePeer.id);
	} else {
		for (const peer of peers) {
			await peer.dispatch(peer.videoTrack, "addClip", {
				name: "maelstrom-fixture.webm",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 4,
			});
		}
		for (const peer of peers) {
			peer.ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();
		}
	}
	const livePeers = peers.map((peer) => options?.getPeer?.(peer.id) ?? peer);
	const clips = await Promise.all(livePeers.map((peer) => peer.ctx.queryRel(peer.videoTrack, "clips")));
	const firstClipId = clips[0]?.[0]?._node_id;
	if (!firstClipId || clips.some((peerClips) => peerClips[0]?._node_id !== firstClipId)) {
		throw new Error("Expected matching maelstrom fixture clip ids across peers");
	}
	return {
		clipId: firstClipId,
		clips: clips.map((peerClips) => peerClips[0]),
	};
};
