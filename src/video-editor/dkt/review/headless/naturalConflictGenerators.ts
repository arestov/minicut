import { expect } from "vitest";
import type { MiniCutReviewItem } from "../types";
import {
	createHeadlessReviewPair,
	type HeadlessDktModel,
	type HeadlessReviewPair,
} from "./createHeadlessReviewPair";

export type NaturalClipTimingConflict = {
	pair: HeadlessReviewPair;
	clipA: HeadlessDktModel;
	clipB: HeadlessDktModel;
	item: MiniCutReviewItem;
};

export type NaturalDanglingResourceConflict = {
	pair: HeadlessReviewPair;
	resourceId: string;
	clipId: string;
	item: MiniCutReviewItem;
};

export type NaturalDeleteVsEditConflict = {
	pair: HeadlessReviewPair;
	clipId: string;
	item: MiniCutReviewItem;
};

export type NaturalTrackOrderConflict = {
	pair: HeadlessReviewPair;
	item: MiniCutReviewItem;
};

export const createNaturalClipTimingConflict = async (
	roomId: string,
): Promise<NaturalClipTimingConflict> => {
	const pair = await createHeadlessReviewPair(roomId);
	await pair.a.dispatch(pair.a.videoTrack, "addClip", {
		name: "headless-timing-conflict.webm",
		mediaKind: "video",
		start: 0,
		in: 0,
		duration: 4,
		fadeIn: 0,
		fadeOut: 0,
	});
	await pair.waitForConvergence();
	const clipA = (await pair.a.queryVideoClips())[0];
	const clipB = (await pair.b.queryVideoClips())[0];
	if (!clipA || !clipB) {
		throw new Error("Expected matching clips for timing conflict");
	}
	expect(clipA._node_id).toBe(clipB._node_id);

	pair.partition();
	await pair.a.dispatch(clipA, "trim", { edge: "end", delta: -1 });
	await pair.b.dispatch(clipB, "trim", { edge: "end", delta: -2 });
	pair.heal();
	await pair.waitForConvergence();

	return {
		pair,
		clipA,
		clipB,
		item: await pair.waitForReviewItem("clip_timing"),
	};
};

export const createNaturalDanglingResourceConflict = async (
	roomId: string,
): Promise<NaturalDanglingResourceConflict> => {
	const pair = await createHeadlessReviewPair(roomId);
	await pair.a.dispatch(pair.a.project, "importResource", {
		name: "headless-dangling-resource.webm",
		kind: "video",
		url: "memory://headless-dangling-resource.webm",
		mime: "video/webm",
		duration: 4,
		status: "ready",
	});
	const resourceA = (await pair.a.ctx.queryRel(pair.a.project, "resources"))[0];
	if (!resourceA) {
		throw new Error("Expected resource for dangling conflict");
	}
	await pair.a.dispatch(pair.a.videoTrack, "addClip", {
		name: "headless-dangling-clip.webm",
		mediaKind: "video",
		start: 0,
		in: 0,
		duration: 4,
	});
	const clipA = (await pair.a.queryVideoClips())[0];
	if (!clipA) {
		throw new Error("Expected clip for dangling conflict");
	}
	await pair.a.dispatch(clipA, "setResource", { resource: resourceA });
	await pair.waitForConvergence();
	const resourceB = (await pair.b.ctx.queryRel(pair.b.project, "resources"))[0];
	const clipB = (await pair.b.queryVideoClips())[0];
	if (!resourceB || !clipB) {
		throw new Error("Expected synced resource clip fixture");
	}
	expect(resourceA._node_id).toBe(resourceB._node_id);
	expect(clipA._node_id).toBe(clipB._node_id);

	await pair.b.dispatch(resourceB, "removeSelf");
	await pair.waitForConvergence();

	return {
		pair,
		resourceId: resourceA._node_id,
		clipId: clipA._node_id,
		item: await pair.waitForReviewItem("dangling_resource"),
	};
};

export const createNaturalDeleteVsEditConflict = async (
	roomId: string,
): Promise<NaturalDeleteVsEditConflict> => {
	const pair = await createHeadlessReviewPair(roomId);
	await pair.a.dispatch(pair.a.videoTrack, "addTextClip", {
		name: "Headless delete edit",
		mediaKind: "text",
		start: 0,
		in: 0,
		duration: 4,
		text: { content: "Original title" },
	});
	await pair.waitForConvergence();
	const clipA = (await pair.a.queryVideoClips())[0];
	const clipB = (await pair.b.queryVideoClips())[0];
	if (!clipA || !clipB) {
		throw new Error("Expected matching text clip for delete-vs-edit conflict");
	}
	const textA = (await pair.a.ctx.queryRel(clipA, "text"))[0];
	if (!textA) {
		throw new Error("Expected text node for delete-vs-edit conflict");
	}

	pair.partition();
	await pair.a.dispatch(textA, "setTextContent", "Edited title from peer A");
	await pair.b.dispatch(clipB, "removeSelf");
	pair.heal();
	await pair.waitForConvergence();

	return {
		pair,
		clipId: clipA._node_id,
		item: await pair.waitForReviewItem("delete_vs_edit"),
	};
};

export const createNaturalTrackOrderConflict = async (
	roomId: string,
): Promise<NaturalTrackOrderConflict> => {
	const pair = await createHeadlessReviewPair(roomId);
	await pair.a.dispatch(pair.a.project, "addTrack", {
		kind: "video",
		name: "Overlay",
	});
	await pair.waitForConvergence();
	const tracksA = await pair.a.ctx.queryRel(pair.a.project, "tracks");
	const tracksB = await pair.b.ctx.queryRel(pair.b.project, "tracks");
	if (tracksA.length < 3 || tracksB.length < 3) {
		throw new Error("Expected at least three tracks for track-order conflict");
	}

	pair.partition();
	await pair.a.dispatch(pair.a.project, "setTracks", {
		tracks: [tracksA[2], tracksA[0], tracksA[1]],
	});
	await pair.b.dispatch(pair.b.project, "setTracks", {
		tracks: [tracksB[1], tracksB[2], tracksB[0]],
	});
	pair.heal();
	await pair.waitForConvergence();

	return {
		pair,
		item: await pair.waitForReviewItem("track_order"),
	};
};