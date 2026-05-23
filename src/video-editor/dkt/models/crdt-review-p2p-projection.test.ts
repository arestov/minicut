import { describe, expect, it } from "vitest";
import {
	inspectReviewGraph,
	waitForProjectReviewGraph,
} from "../review/testHarness/inspectReviewGraph";
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

	it("resolves a natural timing conflict through the product action", async () => {
		const { pair, clipA } = await createPairWithClip(
			"room-review-p2p-timing-resolve",
		);
		try {
			pair.partition();
			await pair.a.dispatch(clipA, "trim", { edge: "end", delta: -1 });
			await pair.b.dispatch(
				(await pair.b.queryVideoClips())[0],
				"trim",
				{ edge: "end", delta: -2 },
			);
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
			const conflictId = item?.attrs.conflictId;
			if (typeof conflictId !== "string") {
				throw new Error("Expected materialized timing conflict id");
			}

			await pair.a.dispatch(
				clipA,
				"resolveClipTimingConflict",
				{
					conflict_id: conflictId,
					start: 0,
					in: 0,
					duration: 3,
				},
				{
					crdt_resolution_attempt: {
						conflict_id: conflictId,
						aggregate: "clipTiming",
						model_id: clipA._node_id,
						model_name: "clip",
					},
				},
			);
			await pair.waitForConvergence();

			expect(await pair.a.ctx.queryAttr(clipA, "duration")).toBe(3);
			expect(
				Number(
					await pair.a.ctx.queryAttr(
						clipA,
						"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
					),
				),
			).toBe(0);
			expect(
				pair.a.ctx.runtime.crdt_runtime?.conflict_store?.readConflicts?.({
					status: "open",
					aggregate: "clipTiming",
				}) ?? [],
			).toEqual([]);
		} finally {
			pair.close();
		}
	});

	it("keeps natural conflict review state out of clip-local conflict relations", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
			"room-review-p2p-no-clip-local-projection",
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
				(snapshot) => snapshot.items.length > 0,
			);

			expect(graph.reviewSessions[0]?.items).toHaveLength(1);
			expect(await pair.a.ctx.queryRel(clipA, "crdtConflicts")).toEqual([]);
		} finally {
			pair.close();
		}
	});

	it("materializes activity summaries from natural p2p sync without conflicts", async () => {
		const pair = await createCrdtWorkerPair({
			roomId: "room-review-p2p-sync-activity",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		try {
			await pair.a.dispatch(pair.a.videoTrack, "addClip", {
				name: "sync-activity.webm",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 4,
			});
			await pair.waitForConvergence();

			let graph = await inspectReviewGraph(pair.b.ctx);
			const deadline = Date.now() + 5_000;
			while (graph.rootActivitySummaries.length === 0 && Date.now() <= deadline) {
				await pair.b.ctx.computed();
				graph = await inspectReviewGraph(pair.b.ctx);
				await new Promise((resolve) => setTimeout(resolve, 25));
			}

			expect(graph.rootReviewItems).toHaveLength(0);
			expect(graph.reviewSessions.flatMap((session) => session.items)).toHaveLength(
				0,
			);
			expect(graph.rootActivitySummaries).toEqual([
				expect.objectContaining({
					modelName: "activity_summary",
					attrs: expect.objectContaining({
						projectId: expect.any(String),
						batchId: expect.any(String),
						title: expect.stringContaining("changes"),
					}),
				}),
			]);
			expect(graph.rootActivitySummaries[0]?.attrs.created).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: expect.any(String),
						id: expect.any(String),
					}),
				]),
			);
		} finally {
			pair.close();
		}
	});
});
