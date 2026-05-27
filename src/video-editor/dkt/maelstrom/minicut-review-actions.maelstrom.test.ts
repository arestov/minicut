import { describe, expect, it } from "vitest";
import { buildClipTimingParkPayload } from "../../components/review/reviewActionPayloads";
import type { ClipTimingVariant } from "../review/features/clipTiming";
import { inspectReviewGraph } from "../review/testHarness/inspectReviewGraph";
import { reviewItemFromGraphNode } from "../review/headless/reviewItemFromGraphNode";
import type { MiniCutReviewItem } from "../review/types";
import { createMiniCutTimelineFixture } from "./fixtures/createMiniCutTimelineFixture";
import { createMiniCutMaelstromProfiles } from "./sim/MiniCutMaelstromProfiles";
import { clipTimingGesture, network } from "./sim/MiniCutScenarioDSL";
import { runMiniCutTrace } from "./sim/MiniCutTraceRunner";
import { createMiniCutCrdtSimulation, type MiniCutPeer } from "./sim/createMiniCutCrdtSimulation";

const memoryProfile = () => {
	const profile = createMiniCutMaelstromProfiles().find(
		(candidate) => candidate.name === "memory",
	);
	if (!profile) throw new Error("Expected memory maelstrom profile");
	return profile;
};

const readClipTimingReviewItems = async (
	peer: MiniCutPeer,
): Promise<MiniCutReviewItem[]> => {
	const graph = await inspectReviewGraph(peer.ctx, peer.ctx.appModel);
	return graph.rootReviewItems
		.map(reviewItemFromGraphNode)
		.filter((item) => item.kind === "clip_timing");
};

const waitForClipTimingGroup = async (
	peer: MiniCutPeer,
): Promise<MiniCutReviewItem[]> => {
	const deadline = Date.now() + 10_000;
	while (Date.now() <= deadline) {
		await peer.ctx.computed();
		const items = await readClipTimingReviewItems(peer);
		if (items.filter((item) => item.status === "open").length > 1) {
			return items.filter((item) => item.status === "open");
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("Expected grouped clip timing review items");
};

const deliverUntilQuiet = async (
	sim: Awaited<ReturnType<typeof createMiniCutCrdtSimulation>>,
) => {
	for (let attempt = 0; attempt < 8 && sim.network.pending().length > 0; attempt += 1) {
		await sim.network.deliverAll({ reorder: false });
		await sim.waitForIdle();
	}
};

const readClipTiming = async (
	peer: MiniCutPeer,
	clipId: string,
): Promise<ClipTimingVariant> => {
	const clip = (await peer.queryVideoClips()).find(
		(candidate) => candidate._node_id === clipId,
	);
	if (!clip) {
		throw new Error(`Expected source clip ${clipId} on peer ${peer.id}`);
	}
	return {
		start: Number(await peer.ctx.queryAttr(clip, "start")),
		in: Number(await peer.ctx.queryAttr(clip, "in")),
		duration: Number(await peer.ctx.queryAttr(clip, "duration")),
		fadeIn: Number(await peer.ctx.queryAttr(clip, "fadeIn") ?? 0),
		fadeOut: Number(await peer.ctx.queryAttr(clip, "fadeOut") ?? 0),
	};
};

const readIncomingReviewTrackClipTiming = async (
	peer: MiniCutPeer,
): Promise<ClipTimingVariant> => {
	const tracks = await peer.ctx.queryRel(peer.project, "tracks");
	for (const track of tracks) {
		if ((await peer.ctx.queryAttr(track, "trackRole")) !== "incomingReview") {
			continue;
		}
		const clips = await peer.ctx.queryRel(track, "clips");
		const clip = clips[0];
		if (!clip) {
			throw new Error(`Expected parked clip on incoming review track for peer ${peer.id}`);
		}
		return {
			start: Number(await peer.ctx.queryAttr(clip, "start")),
			in: Number(await peer.ctx.queryAttr(clip, "in")),
			duration: Number(await peer.ctx.queryAttr(clip, "duration")),
			fadeIn: Number(await peer.ctx.queryAttr(clip, "fadeIn") ?? 0),
			fadeOut: Number(await peer.ctx.queryAttr(clip, "fadeOut") ?? 0),
		};
	}
	throw new Error(`Expected incoming review track for peer ${peer.id}`);
};

describe("MiniCut maelstrom review actions", () => {
	it("parks grouped clip timing from peer B through natural review payloads", async () => {
		const profile = memoryProfile();
		const sim = await createMiniCutCrdtSimulation({
			peers: ["A", "B"],
			storage: profile.storage,
			unloadModels: profile.unloadModels,
		});
		const { clips } = await createMiniCutTimelineFixture(
			[sim.peer("A"), sim.peer("B")],
			{ syncFromPeer: sim.syncFromPeer, getPeer: sim.peer },
		);

		await runMiniCutTrace(
			sim,
			[
				network.partition(["A"], ["B"]),
				clipTimingGesture("A").resizeStart(1, {
					batchId: "review-action:A:resize-start",
				}),
				clipTimingGesture("B").resizeStart(2, {
					batchId: "review-action:B:resize-start",
				}),
				network.heal(),
				network.deliverAll({ duplicate: true, reorder: true, seed: 17 }),
			],
			{ clipByPeer: { A: clips[0], B: clips[1] } },
		);

		const openItems = await waitForClipTimingGroup(sim.peer("B"));
		const conflictIds = openItems.map((item) => item.conflictId).sort();
		const actionItem = openItems[0];
		const expectedSourceTiming = actionItem.preview.current as ClipTimingVariant;
		const expectedParkedTiming = actionItem.preview.incoming as ClipTimingVariant;
		await sim.peer("B").dispatch(
			sim.peer("B").project,
			"parkIncomingVariantOnReviewTrack",
			buildClipTimingParkPayload(actionItem),
		);
		sim.peer("B").flushOutbound();
		await deliverUntilQuiet(sim);

		for (const peerId of ["A", "B"] as const) {
			const items = await readClipTimingReviewItems(sim.peer(peerId));
			const statuses = new Map(items.map((item) => [item.conflictId, item.status]));
			for (const conflictId of conflictIds) {
				expect(statuses.get(conflictId)).toBe("resolved");
			}
			expect(items.filter((item) => item.status === "open")).toHaveLength(0);
			expect(await readClipTiming(sim.peer(peerId), clips[0]._node_id)).toEqual(
				expectedSourceTiming,
			);
			expect(await readIncomingReviewTrackClipTiming(sim.peer(peerId))).toEqual(
				expectedParkedTiming,
			);
		}
	});
});
