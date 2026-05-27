import { describe, expect, it } from "vitest";
import {
	buildClipTimingParkPayload,
	buildClipTimingResolvePayload,
} from "../../../components/review/reviewActionPayloads";
import type {
	ClipTimingPreview,
	ClipTimingVariant,
} from "../features/clipTiming";
import { dispatchReviewActionLikeUi } from "./dispatchReviewActionLikeUi";
import {
	readClipTiming,
	readIncomingReviewTrackClips,
	type ClipTimingSnapshot,
} from "./domainReaders";
import { createNaturalClipTimingConflict } from "./naturalConflictGenerators";
import {
	captureReviewOpenCounts,
	expectReviewGroupResolvedOnBoth,
	expectReviewResolvedOnBoth,
} from "./reviewAssertions";
import { waitForProjectReviewGraph } from "../testHarness/inspectReviewGraph";
import { reviewItemFromGraphNode } from "./reviewItemFromGraphNode";

const clipTimingPreview = (preview: unknown): ClipTimingPreview => {
	if (
		!preview ||
		typeof preview !== "object" ||
		(preview as { type?: unknown }).type !== "clip_timing"
	) {
		throw new Error("Expected clip timing preview");
	}
	return preview as ClipTimingPreview;
};

const expectTimingOnBoth = async (
	pair: Awaited<ReturnType<typeof createNaturalClipTimingConflict>>["pair"],
	clipId: string,
	expected: ClipTimingVariant | ClipTimingSnapshot,
) => {
	for (const peer of [pair.a, pair.b]) {
		expect(await readClipTiming(peer, clipId)).toEqual({
			start: expected.start,
			in: expected.in,
			duration: expected.duration,
			fadeIn: expected.fadeIn,
			fadeOut: expected.fadeOut,
		});
	}
};

const clipTimingGroupConflictIds = async (
	pair: Awaited<ReturnType<typeof createNaturalClipTimingConflict>>["pair"],
	item: { source?: unknown; conflictId: string },
): Promise<string[]> => {
	const groupId =
		item.source && typeof item.source === "object"
			? (item.source as { conflictGroupId?: unknown }).conflictGroupId
			: null;
	const graph = await waitForProjectReviewGraph(
		pair.a.ctx,
		pair.a.project,
		(snapshot) => snapshot.items.some((entry) => entry.attrs.kind === "clip_timing"),
	);
	return graph.items
		.map(reviewItemFromGraphNode)
		.filter(
			(entry) =>
				entry.kind === "clip_timing" &&
				(typeof groupId === "string"
					? (entry.source as { conflictGroupId?: unknown } | null)?.conflictGroupId ===
						groupId
					: entry.conflictId === item.conflictId),
		)
		.map((entry) => entry.conflictId)
		.sort();
};

describe("headless clip timing review actions", () => {
	it("chooses the current timing variant from a natural conflict", async () => {
		const { pair, clipA, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-timing-current",
		);
		try {
			const preview = clipTimingPreview(item.preview);
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"resolveClipTimingConflict",
				buildClipTimingResolvePayload(item, "current"),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTimingOnBoth(pair, clipA._node_id, preview.current);
		} finally {
			pair.close();
		}
	});

	it("chooses the incoming timing variant from a natural conflict", async () => {
		const { pair, clipA, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-timing-incoming",
		);
		try {
			const preview = clipTimingPreview(item.preview);
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"resolveClipTimingConflict",
				buildClipTimingResolvePayload(item, "incoming"),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTimingOnBoth(pair, clipA._node_id, preview.incoming);
		} finally {
			pair.close();
		}
	});

	it("applies a custom final timing draft from the review item", async () => {
		const { pair, clipA, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-timing-custom",
		);
		try {
			const preview = clipTimingPreview(item.preview);
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			const draft = {
				...preview.current,
				duration: Number(Math.max(0.5, preview.current.duration - 0.25).toFixed(3)),
			};
			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"resolveClipTimingConflict",
				buildClipTimingResolvePayload(item, "custom", draft),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTimingOnBoth(pair, clipA._node_id, draft);
		} finally {
			pair.close();
		}
	});

	it("parks the incoming variant on an incoming review track", async () => {
		const { pair, clipA, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-timing-park",
		);
		try {
			const preview = clipTimingPreview(item.preview);
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"parkIncomingVariantOnReviewTrack",
				buildClipTimingParkPayload(item),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTimingOnBoth(pair, clipA._node_id, preview.current);
			for (const peer of [pair.a, pair.b]) {
				const { track, clips } = await readIncomingReviewTrackClips(peer);
				expect(clips).toHaveLength(1);
				expect((await peer.ctx.queryRel(clips[0], "track"))[0]?._node_id).toBe(
					track._node_id,
				);
				expect(await readClipTiming(peer, clips[0]._node_id)).toEqual(
					preview.incoming,
				);
			}
		} finally {
			pair.close();
		}
	});

	it("parks from peer B and resolves the same review item on both peers", async () => {
		const { pair, clipA, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-timing-park-from-b",
		);
		try {
			const itemB = await pair.waitForReviewItem("clip_timing", {
				peer: pair.b,
			});
			const previewB = clipTimingPreview(itemB.preview);
			expect(itemB.conflictId).toBe(item.conflictId);
			const before = await captureReviewOpenCounts(pair, item.conflictId);
			await dispatchReviewActionLikeUi(
				pair.b,
				itemB,
				"parkIncomingVariantOnReviewTrack",
				buildClipTimingParkPayload(itemB),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			await expectTimingOnBoth(pair, clipA._node_id, previewB.current);
		} finally {
			pair.close();
		}
	});

	it("parks a grouped start resize conflict from peer B and resolves every group item", async () => {
		const { pair, item } = await createNaturalClipTimingConflict(
			"room-headless-clip-timing-grouped-park-from-b",
			{ edge: "start" },
		);
		try {
			const itemB = await pair.waitForReviewItem("clip_timing", {
				peer: pair.b,
			});
			const conflictIds = await clipTimingGroupConflictIds(pair, item);
			expect(conflictIds.length).toBeGreaterThan(1);
			const before = await captureReviewOpenCounts(pair, conflictIds[0]);
			expect(before.a.openItemCount).toBe(conflictIds.length);
			expect(before.b.openItemCount).toBe(conflictIds.length);

			await dispatchReviewActionLikeUi(
				pair.b,
				itemB,
				"parkIncomingVariantOnReviewTrack",
				buildClipTimingParkPayload(itemB),
			);

			await expectReviewGroupResolvedOnBoth(pair, conflictIds, before);
		} finally {
			pair.close();
		}
	});
});
