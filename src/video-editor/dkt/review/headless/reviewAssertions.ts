import { expect } from "vitest";
import { waitForProjectReviewGraph } from "../testHarness/inspectReviewGraph";
import type { HeadlessReviewPair, HeadlessReviewPeer } from "./createHeadlessReviewPair";
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

export type ReviewOpenState = {
	conflictId: string;
	status: string | null;
	openItemCount: number;
	sessionOpenItemCount: number | null;
	targetIsOpen: boolean;
};

export type ReviewOpenCountsByPeer = {
	a: ReviewOpenState;
	b: ReviewOpenState;
};

export const readReviewOpenState = async (
	peer: HeadlessReviewPeer,
	conflictId: string,
): Promise<ReviewOpenState> => {
	const graph = await waitForProjectReviewGraph(
		peer.ctx,
		peer.project,
		(snapshot) =>
			snapshot.items.some(
				(item) => reviewItemFromGraphNode(item).conflictId === conflictId,
			),
		{ timeoutMs: 10_000 },
	);
	const item = graph.items
		.map(reviewItemFromGraphNode)
		.find((entry) => entry.conflictId === conflictId);
	if (!item) {
		throw new Error(`Expected review item for conflict ${conflictId}`);
	}
	const sessionOpenItemCount = graph.reviewSessions[0]?.attrs.openItemCount;
	return {
		conflictId,
		status: item.status,
		openItemCount: graph.openItemCount,
		sessionOpenItemCount:
			typeof sessionOpenItemCount === "number" ? sessionOpenItemCount : null,
		targetIsOpen: item.status === "open",
	};
};

export const captureReviewOpenCounts = async (
	pair: HeadlessReviewPair,
	conflictId: string,
): Promise<ReviewOpenCountsByPeer> => {
	await pair.waitForConvergence();
	const [a, b] = await Promise.all([
		readReviewOpenState(pair.a, conflictId),
		readReviewOpenState(pair.b, conflictId),
	]);
	return { a, b };
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

const expectOpenCountDecreased = (
	after: ReviewOpenState,
	before: ReviewOpenState | undefined,
) => {
	if (!before) return;
	expect(before.targetIsOpen).toBe(true);
	expect(after.openItemCount).toBeLessThan(before.openItemCount);
	if (before.sessionOpenItemCount !== null && after.sessionOpenItemCount !== null) {
		expect(after.sessionOpenItemCount).toBeLessThan(
			before.sessionOpenItemCount,
		);
	}
};

const waitForReviewStatusOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
	status: "acknowledged" | "resolved",
): Promise<ReviewOpenCountsByPeer> => {
	await pair.waitForConvergence();
	for (const peer of [pair.a, pair.b]) {
		await waitForProjectReviewGraph(
			peer.ctx,
			peer.project,
			(snapshot) =>
				snapshot.items.some((item) => {
					const reviewItem = reviewItemFromGraphNode(item);
					return reviewItem.conflictId === conflictId && reviewItem.status === status;
				}),
			{ timeoutMs: 10_000 },
		);
	}
	return captureReviewOpenCounts(pair, conflictId);
};

export const expectReviewStatusOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
	status: "acknowledged" | "resolved",
	before?: ReviewOpenCountsByPeer,
) => {
	const after = await waitForReviewStatusOnBoth(pair, conflictId, status);
	for (const [peerName, state] of Object.entries(after) as Array<
		["a" | "b", ReviewOpenState]
	>) {
		expect(state.status).toBe(status);
		expect(state.targetIsOpen).toBe(false);
		expectOpenCountDecreased(state, before?.[peerName]);
		expect(
			conflictStore(pair[peerName]).readConflicts?.({
				conflict_id: conflictId,
				status: "open",
			}) ?? [],
		).toEqual([]);
	}
};

export const expectReviewResolvedOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
	before?: ReviewOpenCountsByPeer,
) => {
	await expectReviewStatusOnBoth(pair, conflictId, "resolved", before);
	await expectConflictStoreResolvedOnBoth(pair, conflictId);
};

export const expectReviewAcknowledgedOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
	before?: ReviewOpenCountsByPeer,
) => {
	await expectReviewStatusOnBoth(pair, conflictId, "acknowledged", before);
	for (const peer of [pair.a, pair.b]) {
		expect(conflictStore(peer).readConflict?.(conflictId)?.status).toBe(
			"acknowledged",
		);
	}
};