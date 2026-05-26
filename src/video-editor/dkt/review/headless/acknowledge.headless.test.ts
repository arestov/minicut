import { describe, expect, it } from "vitest";
import { acknowledgeReviewItemLikeUi } from "./dispatchReviewActionLikeUi";
import { createNaturalClipTimingConflict } from "./naturalConflictGenerators";
import {
	captureReviewOpenCounts,
	expectReviewAcknowledgedOnBoth,
} from "./reviewAssertions";

describe("headless review acknowledge lifecycle", () => {
	it("acknowledges a natural review item without changing domain timing", async () => {
		const { pair, item, clipA } = await createNaturalClipTimingConflict(
			"room-headless-acknowledge",
		);
		try {
			const countsBefore = await captureReviewOpenCounts(pair, item.conflictId);
			const before = {
				start: await pair.a.ctx.queryAttr(clipA, "start"),
				in: await pair.a.ctx.queryAttr(clipA, "in"),
				duration: await pair.a.ctx.queryAttr(clipA, "duration"),
			};
			await acknowledgeReviewItemLikeUi(pair.a, item);
			await expectReviewAcknowledgedOnBoth(
				pair,
				item.conflictId,
				countsBefore,
			);
			expect(await pair.a.ctx.queryAttr(clipA, "start")).toBe(before.start);
			expect(await pair.a.ctx.queryAttr(clipA, "in")).toBe(before.in);
			expect(await pair.a.ctx.queryAttr(clipA, "duration")).toBe(
				before.duration,
			);
		} finally {
			pair.close();
		}
	});
});