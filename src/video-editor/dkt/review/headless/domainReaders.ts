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

const rootModelById = async (
	peer: HeadlessReviewPeer,
	rootRel: string,
	nodeId: string,
): Promise<HeadlessDktModel | null> => {
	const models = (await peer.ctx.queryRel(
		peer.ctx.appModel,
		rootRel,
	)) as HeadlessDktModel[];
	return models.find((entry) => entry._node_id === nodeId) ?? null;
};

const clipByProjectOwnerRel = async (
	peer: HeadlessReviewPeer,
	nodeId: string,
): Promise<HeadlessDktModel | null> => {
	const tracks = (await peer.ctx.queryRel(
		peer.project,
		"tracks",
	)) as HeadlessDktModel[];
	for (const track of tracks) {
		const clips = (await peer.ctx.queryRel(track, "clips")) as HeadlessDktModel[];
		const clip = clips.find((entry) => entry._node_id === nodeId);
		if (clip) return clip;
	}
	return null;
};

const resourceByProjectOwnerRel = async (
	peer: HeadlessReviewPeer,
	nodeId: string,
): Promise<HeadlessDktModel | null> => {
	const resources = (await peer.ctx.queryRel(
		peer.project,
		"resources",
	)) as HeadlessDktModel[];
	return resources.find((entry) => entry._node_id === nodeId) ?? null;
};

export const readClip = async (peer: HeadlessReviewPeer, clipId: string) => {
	const clip =
		(await clipByProjectOwnerRel(peer, clipId)) ??
		((await peer.queryVideoClips()).find((entry) => entry._node_id === clipId) ??
			null) ??
		(await rootModelById(peer, "clip", clipId));
	if (!clip) {
		throw new Error(`Expected clip model ${clipId}`);
	}
	return clip;
};

export const readResource = async (
	peer: HeadlessReviewPeer,
	resourceId: string,
) => {
	const resource =
		(await resourceByProjectOwnerRel(peer, resourceId)) ??
		(await rootModelById(peer, "resource", resourceId));
	if (!resource) {
		throw new Error(`Expected resource model ${resourceId}`);
	}
	return resource;
};

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
