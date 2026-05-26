import { describe, expect, it } from "vitest";
import {
	buildTrackOrderPayload,
	trackOrderIds,
} from "../../../components/review/reviewActionPayloads";
import type { TrackOrderPreview } from "../features/trackOrder";
import { reviewItemFromGraphNode } from "./reviewItemFromGraphNode";
import { dispatchReviewActionLikeUi } from "./dispatchReviewActionLikeUi";
import { createNaturalTrackOrderConflict } from "./naturalConflictGenerators";
import {
	captureReviewOpenCounts,
	expectReviewResolvedOnBoth,
	type ReviewOpenCountsByPeer,
} from "./reviewAssertions";
import type { HeadlessReviewPeer } from "./createHeadlessReviewPair";

const trackOrderPreview = (item: { preview: unknown }): TrackOrderPreview => {
	if (!item.preview || typeof item.preview !== "object") {
		throw new Error("Expected track order preview");
	}
	return item.preview as TrackOrderPreview;
};

const readProjectTrackIds = async (peer: HeadlessReviewPeer) =>
	(await peer.ctx.queryRel(peer.project, "tracks")).map((track) =>
		String(track._node_id),
	);

const expectTrackOrderOnBoth = async (
	peers: HeadlessReviewPeer[],
	trackIds: string[],
) => {
	for (const peer of peers) {
		expect(await readProjectTrackIds(peer)).toEqual(trackIds);
	}
};

const readTrackOrderOnBoth = async (
	pair: Awaited<ReturnType<typeof createNaturalTrackOrderConflict>>["pair"],
) => ({
	a: await readProjectTrackIds(pair.a),
	b: await readProjectTrackIds(pair.b),
});

const expectTrackOrderUnchangedOnBoth = async (
	pair: Awaited<ReturnType<typeof createNaturalTrackOrderConflict>>["pair"],
	before: { a: string[]; b: string[] },
) => {
	expect(await readProjectTrackIds(pair.a)).toEqual(before.a);
	expect(await readProjectTrackIds(pair.b)).toEqual(before.b);
};

const expectReviewOpenCountsUnchanged = (
	after: ReviewOpenCountsByPeer,
	before: ReviewOpenCountsByPeer,
) => {
	expect(after.a).toMatchObject({
		status: "open",
		targetIsOpen: true,
		openItemCount: before.a.openItemCount,
		sessionOpenItemCount: before.a.sessionOpenItemCount,
	});
	expect(after.b).toMatchObject({
		status: "open",
		targetIsOpen: true,
		openItemCount: before.b.openItemCount,
		sessionOpenItemCount: before.b.sessionOpenItemCount,
	});
};

const expandOrder = (orderedSubset: string[], currentOrder: string[]) => [
	...orderedSubset,
	...currentOrder.filter((trackId) => !orderedSubset.includes(trackId)),
];

const waitForReviewItemByConflict = async (
	pair: Awaited<ReturnType<typeof createNaturalTrackOrderConflict>>["pair"],
	conflictId: string,
) => {
	const graph = await pair.waitForReviewGraph((snapshot) =>
		snapshot.items.some((item) => {
			const reviewItem = reviewItemFromGraphNode(item);
			return reviewItem.conflictId === conflictId;
		}),
	);
	const item = graph.items
		.map(reviewItemFromGraphNode)
		.find((entry) => entry.conflictId === conflictId);
	if (!item) {
		throw new Error(`Expected review item for ${conflictId}`);
	}
	return item;
};

describe("headless track order review actions", () => {
	it("keeps current order from a natural track-order review item", async () => {
		const { pair, item } = await createNaturalTrackOrderConflict(
			"room-headless-track-order-current",
		);
		try {
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			const preview = trackOrderPreview(item);
			const expectedOrder = expandOrder(
				trackOrderIds(preview.currentOrder),
				await readProjectTrackIds(pair.a),
			);

			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"preserveCurrentTrackOrder",
				buildTrackOrderPayload(item, "current"),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTrackOrderOnBoth([pair.a, pair.b], expectedOrder);
		} finally {
			pair.close();
		}
	});

	it("applies incoming order from a natural track-order review item", async () => {
		const { pair, item } = await createNaturalTrackOrderConflict(
			"room-headless-track-order-incoming",
		);
		try {
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			const preview = trackOrderPreview(item);
			const expectedOrder = expandOrder(
				trackOrderIds(preview.incomingOrder),
				await readProjectTrackIds(pair.a),
			);

			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"resolveTrackOrderConflict",
				buildTrackOrderPayload(item, "incoming"),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTrackOrderOnBoth([pair.a, pair.b], expectedOrder);
		} finally {
			pair.close();
		}
	});

	it("saves a manual suggestion without resolving", async () => {
		const { pair, item } = await createNaturalTrackOrderConflict(
			"room-headless-track-order-manual-save",
		);
		try {
			const preview = trackOrderPreview(item);
			const manualOrder = [...trackOrderIds(preview.currentOrder)].reverse();
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			const originalOrder = await readTrackOrderOnBoth(pair);

			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"createManualTrackOrderSuggestion",
				buildTrackOrderPayload(item, "manual", manualOrder),
			);

			const updatedItem = await waitForReviewItemByConflict(pair, item.conflictId);
			const updatedPreview = trackOrderPreview(updatedItem);
			const after = await captureReviewOpenCounts(pair, item.conflictId);
			expect(updatedItem.status).toBe("open");
			expect(trackOrderIds(updatedPreview.manualOrder ?? [])).toEqual(manualOrder);
			expectReviewOpenCountsUnchanged(after, before);
			await expectTrackOrderUnchangedOnBoth(pair, originalOrder);
		} finally {
			pair.close();
		}
	});

	it("applies a manual order from the review item", async () => {
		const { pair, item } = await createNaturalTrackOrderConflict(
			"room-headless-track-order-manual-apply",
		);
		try {
			const preview = trackOrderPreview(item);
			const manualOrder = [...trackOrderIds(preview.currentOrder)].reverse();
			const expectedOrder = expandOrder(
				manualOrder,
				await readProjectTrackIds(pair.a),
			);
			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"createManualTrackOrderSuggestion",
				buildTrackOrderPayload(item, "manual", manualOrder),
			);
			const updatedItem = await waitForReviewItemByConflict(pair, item.conflictId);
			const before = await captureReviewOpenCounts(pair, item.conflictId);

			await dispatchReviewActionLikeUi(
				pair.a,
				updatedItem,
				"resolveTrackOrderConflict",
				buildTrackOrderPayload(updatedItem, "manual"),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTrackOrderOnBoth([pair.a, pair.b], expectedOrder);
		} finally {
			pair.close();
		}
	});
});
