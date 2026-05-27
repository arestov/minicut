import { describe, expect, it } from "vitest";
import {
	buildDanglingOfflinePayload,
	buildDanglingRelinkPayload,
} from "../../../components/review/reviewActionPayloads";
import { dispatchReviewActionLikeUi } from "./dispatchReviewActionLikeUi";
import {
	readClip,
	readResourceState,
} from "./domainReaders";
import { createNaturalDanglingResourceConflict } from "./naturalConflictGenerators";
import {
	expectReviewResolvedOnBoth,
	type ReviewOpenCountsByPeer,
} from "./reviewAssertions";

const singleOpenReviewBefore = (conflictId: string): ReviewOpenCountsByPeer => ({
	a: {
		conflictId,
		status: "open",
		openItemCount: 1,
		sessionOpenItemCount: 1,
		targetIsOpen: true,
	},
	b: {
		conflictId,
		status: "open",
		openItemCount: 1,
		sessionOpenItemCount: 1,
		targetIsOpen: true,
	},
});

describe("headless dangling resource review actions", () => {
	it("relinks missing media from a natural dangling-resource conflict", async () => {
		const { pair, item, resourceId, clipId } =
			await createNaturalDanglingResourceConflict(
				"room-headless-dangling-relink",
			);
		try {
			const before = singleOpenReviewBefore(item.conflictId);
			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"resolveDanglingResourceByRelink",
				buildDanglingRelinkPayload(item, {
					replacementUrl: "memory://review/relinked-resource.webm",
					sourceKind: "file",
				}),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			const localResource = await readResourceState(pair.a, resourceId);
			expect(localResource.status).toBe("ready");
			expect(localResource.url).toBe("memory://review/relinked-resource.webm");
			expect(localResource.data).toEqual({ relinkedFromReview: true });

			for (const peer of [pair.a, pair.b]) {
				const resource = await readResourceState(peer, resourceId);
				expect(resource.source).toEqual(
					expect.objectContaining({
						kind: "file",
						localOnlyUrl: true,
						relinkedFromConflictId: item.conflictId,
					}),
				);
				expect(resource.source).not.toHaveProperty("url");
				const clip = await readClip(peer, clipId);
				expect((await peer.ctx.queryRel(clip, "resource"))[0]?._node_id).toBe(
					resourceId,
				);
			}
		} finally {
			pair.close();
		}
	});

	it("keeps an offline placeholder from a natural dangling-resource conflict", async () => {
		const { pair, item, resourceId, clipId } =
			await createNaturalDanglingResourceConflict(
				"room-headless-dangling-offline",
			);
		try {
			const before = singleOpenReviewBefore(item.conflictId);
			await dispatchReviewActionLikeUi(
				pair.a,
				item,
				"keepOfflinePlaceholder",
				buildDanglingOfflinePayload(item),
			);

			await expectReviewResolvedOnBoth(pair, item.conflictId, before);
			const localResource = await readResourceState(pair.a, resourceId);
			expect(localResource.status).toBe("offline");

			for (const peer of [pair.a, pair.b]) {
				const resource = await readResourceState(peer, resourceId);
				expect(resource.source).toEqual(
					expect.objectContaining({
						kind: "offline_placeholder",
						keptFromConflictId: item.conflictId,
					}),
				);
				const clip = await readClip(peer, clipId);
				expect((await peer.ctx.queryRel(clip, "resource"))[0]?._node_id).toBe(
					resourceId,
				);
			}
		} finally {
			pair.close();
		}
	});
});
