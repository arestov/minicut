import { describe, expect, it } from "vitest";
import { buildClipTimingParkPayload } from "../../components/review/reviewActionPayloads";
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
		}
	});
});
