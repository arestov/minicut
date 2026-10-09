import { describe, expect, it } from "vitest";
import { buildDeleteVsEditRestorePayload } from "../../../components/review/reviewActionPayloads";
import {
	type HeadlessReviewPeer,
	createHeadlessReviewPair,
} from "./createHeadlessReviewPair";
import { dispatchReviewActionLikeUi } from "./dispatchReviewActionLikeUi";
import { createNaturalDeleteVsEditConflict } from "./naturalConflictGenerators";
import { expectReviewResolvedOnBoth } from "./reviewAssertions";

const visibleConflictIds = async (peer: HeadlessReviewPeer): Promise<string[]> => {
	await peer.ctx.computed();
	const items = await peer.ctx.queryRel(peer.project, "visibleReviewItems");
	const ids: string[] = [];
	for (const item of items) {
		ids.push(String(await peer.ctx.queryAttr(item, "conflictId")));
	}
	return ids;
};

const statusFilter = async (peer: HeadlessReviewPeer) => {
	await peer.ctx.computed();
	return peer.ctx.queryAttr(peer.project, "reviewStatusFilter");
};

describe("headless review entry and list status filter", () => {
	it("has no review content before any conflict or sync activity", async () => {
		const pair = await createHeadlessReviewPair("room-headless-review-content-empty");
		try {
			await pair.a.ctx.computed();
			expect(await pair.a.ctx.queryAttr(pair.a.project, "hasReviewContent")).toBe(false);
		} finally {
			pair.close();
		}
	});

	it("lists unresolved items by default and switches through the session filters", async () => {
		const { pair, item } = await createNaturalDeleteVsEditConflict(
			"room-headless-review-filter",
		);
		try {
			const peer = pair.a;
			expect(await peer.ctx.queryAttr(peer.project, "hasReviewContent")).toBe(true);
			expect(await statusFilter(peer)).toBe("unresolved");
			expect(await visibleConflictIds(peer)).toEqual([item.conflictId]);

			await peer.dispatch(peer.project, "setReviewStatusFilter", { status: "resolved" });
			expect(await statusFilter(peer)).toBe("resolved");
			expect(await visibleConflictIds(peer)).toEqual([]);

			await peer.dispatch(peer.project, "setReviewStatusFilter", { status: "unresolved" });
			await dispatchReviewActionLikeUi(
				peer,
				item,
				"resolveDeleteVsEditByRestoreVariant",
				buildDeleteVsEditRestorePayload(item),
			);
			await expectReviewResolvedOnBoth(pair, item.conflictId);
			expect(await visibleConflictIds(peer)).toEqual([]);

			await peer.dispatch(peer.project, "setReviewStatusFilter", { status: "resolved" });
			expect(await visibleConflictIds(peer)).toEqual([item.conflictId]);

			await peer.dispatch(peer.project, "setReviewStatusFilter", { status: "all" });
			expect(await statusFilter(peer)).toBe("all");
			expect(await visibleConflictIds(peer)).toEqual([item.conflictId]);

			// Unknown values are ignored: the filter stays as it was.
			await peer.dispatch(peer.project, "setReviewStatusFilter", { status: "bogus" });
			expect(await statusFilter(peer)).toBe("all");
		} finally {
			pair.close();
		}
	});
});
