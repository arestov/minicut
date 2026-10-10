import { describe, expect, it } from "vitest";
import { buildClipTimingResolvePayload } from "../../../components/review/reviewActionPayloads";
import type { HeadlessDktModel, HeadlessReviewPeer } from "./createHeadlessReviewPair";
import {
	acknowledgeReviewItemLikeUi,
	dispatchReviewActionLikeUi,
} from "./dispatchReviewActionLikeUi";
import { createNaturalClipTimingConflict } from "./naturalConflictGenerators";
import {
	expectReviewAcknowledgedOnBoth,
	expectReviewResolvedOnBoth,
} from "./reviewAssertions";

// Mutation and read are separate steps: settle the pair, then read the comp.
const readOpenReviewItemCount = async (
	pair: { waitForConvergence: () => Promise<void> },
	peer: HeadlessReviewPeer,
	clip: HeadlessDktModel,
) => {
	await pair.waitForConvergence();
	await peer.ctx.computed();
	return peer.ctx.queryAttr(clip, "openReviewItemCount");
};

describe("headless clip open review item count", () => {
	it("counts the open clip timing items of the clip on the peer that created it and drops to zero after resolve", async () => {
		const { pair, clipA, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-conflict-badge",
		);
		try {
			expect(await readOpenReviewItemCount(pair, pair.a, clipA)).toBe(1);

			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"resolveClipTimingConflict",
				buildClipTimingResolvePayload(item, "current"),
			);
			await expectReviewResolvedOnBoth(pair, item.conflictId);

			expect(await readOpenReviewItemCount(pair, pair.a, clipA)).toBe(0);
		} finally {
			pair.close();
		}
	});

	it("drops the count when the open item is acknowledged", async () => {
		const { pair, clipA, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-conflict-badge-ack",
		);
		try {
			expect(await readOpenReviewItemCount(pair, pair.a, clipA)).toBe(1);

			await acknowledgeReviewItemLikeUi(pair.a, item);
			await expectReviewAcknowledgedOnBoth(pair, item.conflictId);

			expect(await readOpenReviewItemCount(pair, pair.a, clipA)).toBe(0);
		} finally {
			pair.close();
		}
	});

	// Incoming clips must compute the badge from their materialized open review item.
	it("counts the open clip timing items on the peer that received the clip", async () => {
		const { pair, clipB } = await createNaturalClipTimingConflict(
			"room-headless-clip-conflict-badge-remote",
		);
		try {
			await pair.waitForReviewItem("clip_timing", { peer: pair.b });
			expect(await readOpenReviewItemCount(pair, pair.b, clipB)).toBe(1);
		} finally {
			pair.close();
		}
	});
});
