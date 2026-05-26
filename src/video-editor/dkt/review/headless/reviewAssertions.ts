import { expect } from "vitest";
import { waitForProjectReviewGraph } from "../testHarness/inspectReviewGraph";
import type { HeadlessReviewPair } from "./createHeadlessReviewPair";
import { reviewItemFromGraphNode } from "./reviewItemFromGraphNode";

type ConflictStore = {
	readConflict?: (conflictId: string) => { status?: unknown } | null;
	readConflicts?: (filter?: Record<string, unknown>) => Array<{ status?: unknown }>;
};

const conflictStore = (peer: HeadlessReviewPair["a"]): ConflictStore => {
	const store = peer.ctx.runtime.crdt_runtime?.conflict_store as
		| ConflictStore
		| undefined;
	if (!store?.readConflict || !store.readConflicts) {
		throw new Error("Expected CRDT conflict store");
	}
	return store;
};

export const expectConflictStoreResolvedOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
) => {
	await pair.waitForConvergence();
	for (const peer of [pair.a, pair.b]) {
		expect(conflictStore(peer).readConflict?.(conflictId)?.status).toBe(
			"resolved",
		);
		expect(
			conflictStore(peer).readConflicts?.({ conflict_id: conflictId, status: "open" }) ?? [],
		).toEqual([]);
	}
};

export const expectReviewResolvedOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
) => {
	await pair.waitForConvergence();
	for (const peer of [pair.a, pair.b]) {
		const graph = await waitForProjectReviewGraph(
			peer.ctx,
			peer.project,
			(snapshot) =>
				snapshot.items.some((item) => {
					const reviewItem = reviewItemFromGraphNode(item);
					return (
						reviewItem.conflictId === conflictId &&
						reviewItem.status === "resolved"
					);
				}),
			{ timeoutMs: 10_000 },
		);
		const item = graph.items
			.map(reviewItemFromGraphNode)
			.find((entry) => entry.conflictId === conflictId);
		expect(item?.status).toBe("resolved");
		expect(graph.openItemCount).toBe(0);
		expect(graph.reviewSessions[0]?.attrs.openItemCount).toBe(0);
	}
	await expectConflictStoreResolvedOnBoth(pair, conflictId);
};