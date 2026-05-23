import { describe, expect, it } from "vitest";
import { waitForProjectReviewGraph } from "../review/testHarness/inspectReviewGraph";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";

const createPairWithClip = async (roomId: string) => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	await pair.a.dispatch(pair.a.videoTrack, "addClip", {
		name: "review-conflict.webm",
		mediaKind: "video",
		start: 0,
		in: 0,
		duration: 4,
	});
	await pair.waitForConvergence();
	const clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
	const clipB = (await pair.b.ctx.queryRel(pair.b.videoTrack, "clips"))[0];
	if (!clipA || !clipB) {
		throw new Error("Expected matching clips");
	}
	expect(clipA._node_id).toBe(clipB._node_id);
	return { pair, clipA, clipB };
};

describe("MiniCut p2p review projection", () => {
	it("materializes a project review session from a natural two-peer timing conflict", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
			"room-review-p2p-timing-conflict",
		);
		try {
			pair.partition();
			await pair.a.dispatch(clipA, "trim", { edge: "end", delta: -1 });
			await pair.b.dispatch(clipB, "trim", { edge: "end", delta: -2 });
			pair.heal();
			await pair.waitForConvergence();

			const graph = await waitForProjectReviewGraph(
				pair.a.ctx,
				pair.a.project,
				(snapshot) =>
					snapshot.items.some((item) => item.attrs.kind === "clip_timing"),
			);
			const item = graph.items.find(
				(entry) => entry.attrs.kind === "clip_timing",
			);

			expect(graph.reviewSessions).toHaveLength(1);
			expect(graph.openItemCount).toBe(1);
			expect(item?.attrs).toEqual(
				expect.objectContaining({
					kind: "clip_timing",
					status: "open",
					source: expect.objectContaining({
						conflictId: expect.any(String),
					}),
				}),
			);
			expect(item?.attrs.affectedObjects).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: clipA._node_id,
					}),
				]),
			);
			expect(graph.reviewSessions[0]?.items.map((entry) => entry.nodeId)).toContain(
				item?.nodeId,
			);
		} finally {
			pair.close();
		}
	});
});
