import { afterEach, describe, expect, test } from "bun:test";
import { AppShell } from "../AppShell";
import {
	createConflictPeers,
	createSharedProject,
	joinSharedProject,
	renderOnPeer,
	untilPeerAttr,
	untilPeerMany,
	type ConflictPeers,
} from "../test/conflictPeers";

// Sync activity from real peer batches: peer A edits the shared project and
// peer B, looking at it, gets an activity summary for the received batch.

let peers: ConflictPeers | null = null;
let view: ReturnType<typeof renderOnPeer> | null = null;
afterEach(() => {
	view?.destroy();
	peers?.destroy();
	view = null;
	peers = null;
});

describe("review mode: sync activity from a real remote batch", () => {
	test("peer B lists the batch peer A made on the project it has open", async () => {
		peers = await createConflictPeers("gpuix-activity-1");
		const shared = await createSharedProject(peers);
		const joined = await joinSharedProject(peers, shared.project._nodeId);
		view = renderOnPeer(peers.b, () => <AppShell />);

		await peers.a.driver.run(
			"addClip",
			{ name: "remote.webm", mediaKind: "video", start: 0, in: 0, duration: 4 },
			shared.tracks[0],
		);
		await peers.b.driver.waitMany(joined.tracks[0], "clips", 1);

		// The summary belongs to the project the batch touched (B's active project).
		const summaries = await untilPeerMany(peers.b, joined.project, "activitySummaries", (n) => n >= 1);
		await untilPeerAttr(peers.b, summaries[0], "projectId", (v) => v === joined.project._nodeId);
		await untilPeerAttr(peers.b, summaries[0], "batchId", (v) => v != null);
		view.settle();
		expect(view.has("review-trigger")).toBe(true);
		view.click("review-trigger");
		await untilPeerAttr(peers.b, summaries[0], "title", (v) => v != null);
		view.settle();
		expect(view.has("review-mode")).toBe(true);
		expect(view.has("activity-row")).toBe(true);
		expect(view.texts().some((text) => text.startsWith("Imported changes from"))).toBe(true);
		expect(view.texts()).not.toContain("No sync activity");
	}, 30_000);
});
