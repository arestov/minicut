import { describe, expect, it } from "vitest";
import { createHeadlessReviewPair } from "./createHeadlessReviewPair";
import { dispatchReviewActionLikeUi } from "./dispatchReviewActionLikeUi";

describe("headless review pair", () => {
	it("boots a real CRDT pair and reads an empty project review graph", async () => {
		const pair = await createHeadlessReviewPair("room-headless-review-empty");
		try {
			const graph = await pair.waitForReviewGraph(
				(snapshot) => snapshot.items.length === 0,
				{ timeoutMs: 1_000 },
			);
			expect(graph.items).toEqual([]);
			expect(graph.openItemCount).toBe(0);
		} finally {
			pair.close();
		}
	});

	it("fails loudly when a review action target is absent", async () => {
		const pair = await createHeadlessReviewPair("room-headless-review-no-target");
		try {
			await expect(
				dispatchReviewActionLikeUi(
					pair.a,
					{
						id: "review:missing-target",
						conflictId: "conflict:missing-target",
						projectId: pair.a.project._node_id,
						kind: "unknown",
						status: "open",
						title: "Missing target",
						affectedObjects: [],
						preview: null,
						availableActions: ["resolveClipTimingConflict"],
						actionTargets: {},
						source: { conflictId: "conflict:missing-target" },
					},
					"resolveClipTimingConflict",
				),
			).rejects.toThrow(/has no action target/);
		} finally {
			pair.close();
		}
	});
});