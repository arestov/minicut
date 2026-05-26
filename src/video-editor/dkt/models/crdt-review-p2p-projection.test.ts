import { describe, expect, it } from "vitest";
import {
	inspectReviewGraph,
	waitForProjectReviewGraph,
} from "../review/testHarness/inspectReviewGraph";
import { clipTimingConflictFixture } from "../review/features/clipTiming/fixtures";
import type { CrdtConflictRecord } from "../review/types";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";

type Pair = Awaited<ReturnType<typeof createCrdtWorkerPair>>;
type Peer = Pair["a"];

type ConflictStore = {
	writeConflict?: (conflict: CrdtConflictRecord) => unknown;
	readConflict?: (conflictId: string) => { status?: unknown } | null;
};

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

const conflictStore = (peer: Peer): ConflictStore => {
	const store = peer.ctx.runtime.crdt_runtime?.conflict_store as
		| ConflictStore
		| undefined;
	if (!store?.writeConflict || !store.readConflict) {
		throw new Error("Expected CRDT conflict store");
	}
	return store;
};

const seedConflictOnBothPeers = (pair: Pair, conflict: CrdtConflictRecord) => {
	conflictStore(pair.a).writeConflict?.({ ...conflict, status: "open" });
	conflictStore(pair.b).writeConflict?.({ ...conflict, status: "open" });
};

const expectConflictResolvedOnBothPeers = async (
	pair: Pair,
	conflictId: string,
) => {
	await pair.waitForConvergence();
	expect(conflictStore(pair.a).readConflict?.(conflictId)?.status).toBe(
		"resolved",
	);
	expect(conflictStore(pair.b).readConflict?.(conflictId)?.status).toBe(
		"resolved",
	);
};

const waitForIncomingReviewTrackWithParkedClip = async (peer: Peer) => {
	const deadline = Date.now() + 5_000;
	let lastTrackSummary: unknown[] = [];
	while (Date.now() <= deadline) {
		await peer.ctx.computed();
		const tracks = await peer.ctx.queryRel(peer.project, "tracks");
		lastTrackSummary = [];
		for (const track of tracks) {
			const trackRole = await peer.ctx.queryAttr(track, "trackRole");
			const clips = await peer.ctx.queryRel(track, "clips");
			lastTrackSummary.push({
				id: track._node_id,
				role: trackRole,
				name: await peer.ctx.queryAttr(track, "name"),
				clipCount: clips.length,
			});
			if (trackRole === "incomingReview" && clips.length > 0) {
				return { track, clips };
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(
		`Expected incoming review track with parked clip on peer ${peer.id}; saw ${JSON.stringify(lastTrackSummary)}`,
	);
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

			const [graphA, graphB] = await Promise.all([
				waitForProjectReviewGraph(
					pair.a.ctx,
					pair.a.project,
					(snapshot) =>
						snapshot.items.some((item) => item.attrs.kind === "clip_timing"),
				),
				waitForProjectReviewGraph(
					pair.b.ctx,
					pair.b.project,
					(snapshot) =>
						snapshot.items.some((item) => item.attrs.kind === "clip_timing"),
				),
			]);
			const items = [graphA, graphB].map((graph) =>
				graph.items.find((entry) => entry.attrs.kind === "clip_timing"),
			);

			for (const [graph, item] of [
				[graphA, items[0]],
				[graphB, items[1]],
			] as const) {
				expect(graph.reviewSessions).toHaveLength(1);
				if ("openItemCount" in graph) {
					expect(graph.openItemCount).toBe(1);
				}
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
				expect(
					graph.reviewSessions[0]?.items.map((entry) => entry.nodeId),
				).toContain(item?.nodeId);
			}
			expect(items[0]?.attrs.conflictId).toBe(items[1]?.attrs.conflictId);
		} finally {
			pair.close();
		}
	});

	it("resolves a natural timing conflict through the product action", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
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

			const [graphA, graphB] = await Promise.all([
				waitForProjectReviewGraph(
					pair.a.ctx,
					pair.a.project,
					(snapshot) =>
						snapshot.items.some((item) => item.attrs.kind === "clip_timing"),
				),
				waitForProjectReviewGraph(
					pair.b.ctx,
					pair.b.project,
					(snapshot) =>
						snapshot.items.some((item) => item.attrs.kind === "clip_timing"),
				),
			]);
			expect(graphB.items).toHaveLength(1);
			const item = graphA.items.find(
				(entry) => entry.attrs.kind === "clip_timing",
			);
			const remoteItem = graphB.items.find(
				(entry) => entry.attrs.kind === "clip_timing",
			);
			expect(remoteItem?.attrs.conflictId).toBe(item?.attrs.conflictId);
			const conflictId = item?.attrs.conflictId;
			if (typeof conflictId !== "string") {
				throw new Error("Expected materialized timing conflict id");
			}

			await pair.a.dispatch(
				clipA,
				"resolveClipTimingConflict",
				{
					conflictId,
					reviewItemId: `review:${conflictId}`,
					selectedVariant: "incoming",
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
			expect(await pair.b.ctx.queryAttr(clipB, "duration")).toBe(3);
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
			expect(
				pair.b.ctx.runtime.crdt_runtime?.conflict_store?.readConflicts?.({
					status: "open",
					aggregate: "clipTiming",
				}) ?? [],
			).toEqual([]);
			const [resolvedGraphA, resolvedGraphB] = await Promise.all([
				waitForProjectReviewGraph(
					pair.a.ctx,
					pair.a.project,
					(snapshot) =>
						snapshot.items.some(
							(entry) =>
								entry.attrs.conflictId === conflictId &&
								entry.attrs.status === "resolved",
						),
				),
				waitForProjectReviewGraph(
					pair.b.ctx,
					pair.b.project,
					(snapshot) =>
						snapshot.items.some(
							(entry) =>
								entry.attrs.conflictId === conflictId &&
								entry.attrs.status === "resolved",
						),
				),
			]);
			for (const graph of [resolvedGraphA, resolvedGraphB]) {
				const resolvedItem = graph.items.find(
					(entry) => entry.attrs.conflictId === conflictId,
				);
				expect(resolvedItem?.attrs.status).toBe("resolved");
				expect(graph.openItemCount).toBe(0);
				expect(graph.reviewSessions[0]?.attrs.openItemCount).toBe(0);
			}
		} finally {
			pair.close();
		}
	});

	it("applies clip timing review choices to state and conflict lifecycle on both peers", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
			"room-review-p2p-button-clip-timing",
		);
		try {
			for (const [suffix, payload, expected] of [
				[
					"current",
					{
						selectedVariant: "current",
						start: 0,
						in: 0,
						duration: 4,
						fadeIn: 0,
						fadeOut: 0,
					},
					{ start: 0, in: 0, duration: 4 },
				],
				[
					"incoming",
					{
						selectedVariant: "incoming",
						start: 2,
						in: 1,
						duration: 3,
						fadeIn: 0.2,
						fadeOut: 0.1,
					},
					{ start: 2, in: 1, duration: 3 },
				],
				[
					"custom",
					{
						selectedVariant: "custom",
						start: 1,
						in: 0.5,
						duration: 2.5,
						fadeIn: 0,
						fadeOut: 0,
					},
					{ start: 1, in: 0.5, duration: 2.5 },
				],
			] as const) {
				const conflictId = `conflict:clip-timing:${suffix}`;
				seedConflictOnBothPeers(pair, {
					...clipTimingConflictFixture,
					conflict_id: conflictId,
					node_id: clipA._node_id,
					payload: {
						current: { start: 0, in: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
						incoming: {
							start: 2,
							in: 1,
							duration: 3,
							fadeIn: 0.2,
							fadeOut: 0.1,
						},
					},
				});
				await pair.a.dispatch(clipA, "resolveClipTimingConflict", {
					conflictId,
					reviewItemId: `review:${conflictId}`,
					...payload,
				});
				await expectConflictResolvedOnBothPeers(pair, conflictId);
				expect(await pair.a.ctx.queryAttr(clipA, "start")).toBe(expected.start);
				expect(await pair.b.ctx.queryAttr(clipB, "start")).toBe(expected.start);
				expect(await pair.a.ctx.queryAttr(clipA, "in")).toBe(expected.in);
				expect(await pair.b.ctx.queryAttr(clipB, "in")).toBe(expected.in);
				expect(await pair.a.ctx.queryAttr(clipA, "duration")).toBe(
					expected.duration,
				);
				expect(await pair.b.ctx.queryAttr(clipB, "duration")).toBe(
					expected.duration,
				);
			}
		} finally {
			pair.close();
		}
	});

	it("parks an incoming timing variant into review tracks on both peers", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
			"room-review-p2p-button-park-incoming",
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
			const conflictId = item?.attrs.conflictId;
			if (typeof conflictId !== "string") {
				throw new Error("Expected materialized timing conflict id");
			}

			await pair.a.dispatch(pair.a.project, "parkIncomingVariantOnReviewTrack", {
				conflictId,
				reviewItemId: `review:${conflictId}`,
				clipId: clipA._node_id,
				variant: "incoming",
				timing: {
					start: 0,
					in: 0,
					duration: 2,
					fadeIn: 0,
					fadeOut: 0,
				},
			});

			await expectConflictResolvedOnBothPeers(pair, conflictId);
			for (const peer of [pair.a, pair.b]) {
				const { track, clips: parkedClips } =
					await waitForIncomingReviewTrackWithParkedClip(peer);
				expect(parkedClips).toHaveLength(1);
				expect(await peer.ctx.queryAttr(parkedClips[0], "start")).toBe(0);
				expect(await peer.ctx.queryAttr(parkedClips[0], "in")).toBe(0);
				expect(await peer.ctx.queryAttr(parkedClips[0], "duration")).toBe(2);
				expect((await peer.ctx.queryRel(parkedClips[0], "track"))[0]?._node_id).toBe(
					track._node_id,
				);
			}
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

			const [graphA, graphB] = await Promise.all([
				waitForProjectReviewGraph(
					pair.a.ctx,
					pair.a.project,
					(snapshot) => snapshot.items.length > 0,
				),
				waitForProjectReviewGraph(
					pair.b.ctx,
					pair.b.project,
					(snapshot) => snapshot.items.length > 0,
				),
			]);

			expect(graphA.reviewSessions[0]?.items).toHaveLength(1);
			expect(graphB.reviewSessions[0]?.items).toHaveLength(1);
			expect(await pair.a.ctx.queryRel(clipA, "crdtConflicts")).toEqual([]);
			expect(await pair.b.ctx.queryRel(clipB, "crdtConflicts")).toEqual([]);
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
