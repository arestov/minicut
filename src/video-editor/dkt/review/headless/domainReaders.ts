import type { HeadlessDktModel, HeadlessReviewPeer } from "./createHeadlessReviewPair";

export type ClipTimingSnapshot = {
	start: number;
	in: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
};

const numberAttr = async (
	peer: HeadlessReviewPeer,
	model: HeadlessDktModel,
	attr: string,
	fallback = 0,
): Promise<number> => {
	const value = await peer.ctx.queryAttr(model, attr);
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const modelById = async (
	peer: HeadlessReviewPeer,
	rootRel: string,
	nodeId: string,
): Promise<HeadlessDktModel> => {
	const models = (await peer.ctx.queryRel(
		peer.ctx.appModel,
		rootRel,
	)) as HeadlessDktModel[];
	const model = models.find((entry) => entry._node_id === nodeId);
	if (!model) {
		throw new Error(`Expected ${rootRel} model ${nodeId}`);
	}
	return model;
};

export const readClip = (peer: HeadlessReviewPeer, clipId: string) =>
	modelById(peer, "clip", clipId);

export const readResource = (peer: HeadlessReviewPeer, resourceId: string) =>
	modelById(peer, "resource", resourceId);

export const readClipTiming = async (
	peer: HeadlessReviewPeer,
	clipId: string,
): Promise<ClipTimingSnapshot> => {
	const clip = await readClip(peer, clipId);
	return {
		start: await numberAttr(peer, clip, "start"),
		in: await numberAttr(peer, clip, "in"),
		duration: await numberAttr(peer, clip, "duration"),
		fadeIn: await numberAttr(peer, clip, "fadeIn"),
		fadeOut: await numberAttr(peer, clip, "fadeOut"),
	};
};

export const readTrackOrder = async (
	peer: HeadlessReviewPeer,
): Promise<string[]> =>
	(await peer.ctx.queryRel(peer.project, "tracks")).map((track) =>
		String(track._node_id),
	);

export const readIncomingReviewTrackClips = async (
	peer: HeadlessReviewPeer,
): Promise<{ track: HeadlessDktModel; clips: HeadlessDktModel[] }> => {
	const tracks = (await peer.ctx.queryRel(
		peer.project,
		"tracks",
	)) as HeadlessDktModel[];
	for (const track of tracks) {
		if ((await peer.ctx.queryAttr(track, "trackRole")) !== "incomingReview") {
			continue;
		}
		return {
			track,
			clips: (await peer.ctx.queryRel(track, "clips")) as HeadlessDktModel[],
		};
	}
	throw new Error("Expected incoming review track");
};

export const readResourceState = async (
	peer: HeadlessReviewPeer,
	resourceId: string,
) => {
	const resource = await readResource(peer, resourceId);
	return {
		resource,
		status: await peer.ctx.queryAttr(resource, "status"),
		url: await peer.ctx.queryAttr(resource, "url"),
		source: await peer.ctx.queryAttr(resource, "source"),
		data: await peer.ctx.queryAttr(resource, "data"),
	};
};

export const readArchiveEntries = async (peer: HeadlessReviewPeer) =>
	peer.ctx.queryRel(peer.project, "reviewArchiveEntries");