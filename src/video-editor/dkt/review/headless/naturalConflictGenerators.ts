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