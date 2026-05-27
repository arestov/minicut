import { expect } from "vitest";
import { inspectReviewGraph } from "../testHarness/inspectReviewGraph";
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

export type ReviewStatusExpectation = {
	expectedOpenItemCount?: number;
	expectedSessionOpenItemCount?: number;
};

export const readReviewOpenState = async (
	peer: HeadlessReviewPeer,
	conflictId: string,
): Promise<ReviewOpenState> => {
	const deadline = Date.now() + 10_000;
	let graph = await inspectReviewGraph(peer.ctx, peer.ctx.appModel);
	while (Date.now() <= deadline) {
		await peer.ctx.computed();
		graph = await inspectReviewGraph(peer.ctx, peer.ctx.appModel);
		if (
			graph.rootReviewItems.some(
				(item) => reviewItemFromGraphNode(item).conflictId === conflictId,
			)
		) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	const item = graph.rootReviewItems
		.map(reviewItemFromGraphNode)
		.find((entry) => entry.conflictId === conflictId);
	if (!item) {
		throw new Error(`Expected review item for conflict ${conflictId}`);
	}
	const sessionOpenItemCount = graph.reviewSessions.find((session) =>
		session.items.some(
			(entry) => reviewItemFromGraphNode(entry).conflictId === conflictId,
		),
	)?.attrs.openItemCount;
	return {
		conflictId,
		status: item.status,
		openItemCount: graph.rootReviewItems.filter(
			(entry) => entry.attrs.status === "open",
		).length,
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

export const captureReviewGroupOpenCounts = async (
	pair: HeadlessReviewPair,
	conflictIds: readonly string[],
): Promise<ReviewOpenCountsByPeer> => captureReviewOpenCounts(pair, conflictIds[0]);

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

const expectOpenCountResolved = (
	after: ReviewOpenState,
	before: ReviewOpenState | undefined,
	expectation: ReviewStatusExpectation = {},
) => {
	if (!before) return;
	expect(before.targetIsOpen).toBe(true);
	expect(after.openItemCount).toBe(
		expectation.expectedOpenItemCount ?? before.openItemCount - 1,
	);
	if (before.sessionOpenItemCount !== null && after.sessionOpenItemCount !== null) {
		expect(after.sessionOpenItemCount).toBe(
			expectation.expectedSessionOpenItemCount ??
				Math.max(0, before.sessionOpenItemCount - 1),
		);
	}
	if (after.sessionOpenItemCount !== null) {
		expect(after.sessionOpenItemCount).toBe(after.openItemCount);
	}
};

const waitForReviewStatusOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
	status: "acknowledged" | "resolved",
): Promise<ReviewOpenCountsByPeer> => {
	await pair.waitForConvergence();
	for (const peer of [pair.a, pair.b]) {
		const deadline = Date.now() + 10_000;
		let matched = false;
		while (Date.now() <= deadline) {
			await peer.ctx.computed();
			const graph = await inspectReviewGraph(peer.ctx, peer.ctx.appModel);
			matched = graph.rootReviewItems.some((item) => {
				const reviewItem = reviewItemFromGraphNode(item);
				return reviewItem.conflictId === conflictId && reviewItem.status === status;
			});
			if (matched) break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(matched).toBe(true);
	}
	return captureReviewOpenCounts(pair, conflictId);
};

export const expectReviewStatusOnBoth = async (
	pair: HeadlessReviewPair,
	conflictId: string,
	status: "acknowledged" | "resolved",
	before?: ReviewOpenCountsByPeer,
	expectation: ReviewStatusExpectation = {},
) => {
	const after = await waitForReviewStatusOnBoth(pair, conflictId, status);
	for (const [peerName, state] of Object.entries(after) as Array<
		["a" | "b", ReviewOpenState]
	>) {
		expect(state.status).toBe(status);
		expect(state.targetIsOpen).toBe(false);
		expectOpenCountResolved(state, before?.[peerName], expectation);
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
	expectation: ReviewStatusExpectation = {},
) => {
	await expectReviewStatusOnBoth(pair, conflictId, "resolved", before, expectation);
	await expectConflictStoreResolvedOnBoth(pair, conflictId);
};

export const expectReviewGroupResolvedOnBoth = async (
	pair: HeadlessReviewPair,
	conflictIds: readonly string[],
	before: ReviewOpenCountsByPeer,
) => {
	if (conflictIds.length === 0) {
		throw new Error("Expected at least one review conflict id");
	}
	await expectReviewResolvedOnBoth(pair, conflictIds[0], before, {
		expectedOpenItemCount: Math.max(0, before.a.openItemCount - conflictIds.length),
		expectedSessionOpenItemCount:
			before.a.sessionOpenItemCount == null
				? undefined
				: Math.max(0, before.a.sessionOpenItemCount - conflictIds.length),
	});
	for (const conflictId of conflictIds) {
		await expectConflictStoreResolvedOnBoth(pair, conflictId);
		for (const peer of [pair.a, pair.b]) {
			expect(
				conflictStore(peer).readConflicts?.({
					conflict_id: conflictId,
					status: "open",
				}) ?? [],
			).toEqual([]);
		}
	}
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
