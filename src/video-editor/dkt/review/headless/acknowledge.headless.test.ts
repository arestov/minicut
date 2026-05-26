import { describe, expect, it } from "vitest";
import { waitForProjectReviewGraph } from "../testHarness/inspectReviewGraph";
import { acknowledgeReviewItemLikeUi } from "./dispatchReviewActionLikeUi";
import { createNaturalClipTimingConflict } from "./naturalConflictGenerators";
import { reviewItemFromGraphNode } from "./reviewItemFromGraphNode";

type ConflictStore = {
	readConflict?: (conflictId: string) => { status?: unknown } | null;
};

const conflictStore = (peer: Awaited<ReturnType<typeof createNaturalClipTimingConflict>>["pair"]["a"]) =>
	peer.ctx.runtime.crdt_runtime?.conflict_store as ConflictStore | undefined;

describe("headless review acknowledge lifecycle", () => {
	it("acknowledges a natural review item without changing domain timing", async () => {
		const { pair, item, clipA } = await createNaturalClipTimingConflict(
			"room-headless-acknowledge",
		);
		try {
			const before = {
				start: await pair.a.ctx.queryAttr(clipA, "start"),
				in: await pair.a.ctx.queryAttr(clipA, "in"),
				duration: await pair.a.ctx.queryAttr(clipA, "duration"),
			};
			await acknowledgeReviewItemLikeUi(pair.a, item);
			await pair.waitForConvergence();

			for (const peer of [pair.a, pair.b]) {
				const graph = await waitForProjectReviewGraph(
					peer.ctx,
					peer.project,
					(snapshot) =>
						snapshot.items.some((entry) => {
							const reviewItem = reviewItemFromGraphNode(entry);
							return (
								reviewItem.conflictId === item.conflictId &&
								reviewItem.status === "acknowledged"
							);
						}),
					{ timeoutMs: 10_000 },
				);
				const acknowledged = graph.items
					.map(reviewItemFromGraphNode)
					.find((entry) => entry.conflictId === item.conflictId);
				expect(acknowledged?.status).toBe("acknowledged");
				expect(graph.openItemCount).toBe(0);
				expect(conflictStore(peer)?.readConflict?.(item.conflictId)?.status).toBe(
					"acknowledged",
				);
			}
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