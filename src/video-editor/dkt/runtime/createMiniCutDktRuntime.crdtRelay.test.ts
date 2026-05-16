import { describe, expect, it } from "vitest";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";

const pairOptions = (roomId: string) => ({
	roomId,
	profileId: "minicut-crdt-v1",
	profileVersion: 1,
});

const addMatchingClip = async (pair: Awaited<ReturnType<typeof createCrdtWorkerPair>>) => {
	for (const peer of [pair.a, pair.b]) {
		await peer.dispatch(peer.videoTrack, "addClip", {
			name: "relay-fixture.webm",
			mediaKind: "video",
			start: 0,
			in: 0,
			duration: 4,
		});
		drainCrdtOutbox(peer.ctx.runtime);
	}
	const clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
	const clipB = (await pair.b.ctx.queryRel(pair.b.videoTrack, "clips"))[0];
	if (!clipA || !clipB) {
		throw new Error("Expected matching clips");
	}
	expect(clipA._node_id).toBe(clipB._node_id);
	return { clipA, clipB };
};

describe("MiniCut CRDT relay convergence", () => {
	it("converges project attrs through the in-memory relay", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-project-attr"));

		await pair.a.dispatch(pair.a.project, "renameProject", "Relay title");
		pair.a.flushOutbound();
		await pair.waitForConvergence();

		expect(pair.b.readProjectTitle()).toBe("Relay title");
		expect(drainCrdtOutbox(pair.b.ctx.runtime)).toEqual([]);
		pair.close();
	});

	it("records a structural conflict when remote delete touches local clip activity", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-membership"));
		await addMatchingClip(pair);

		const clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
		if (!clipA) {
			throw new Error("Expected matching clip");
		}
		const originalClipIds = pair.b.readVideoClipIds();

		await pair.a.dispatch(clipA, "removeSelf");
		pair.a.flushOutbound();
		await pair.waitForConvergence();

		expect(pair.b.readVideoClipIds()).toEqual(originalClipIds);
		expect(
			Number(
				pair.b.ctx.getAttr(
					pair.b.videoTrack,
					"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
				) ?? 0,
			),
		).toBeGreaterThan(0);
		pair.close();
	});

	it("converges clip timing edits", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-clip-timing"));
		const { clipA, clipB } = await addMatchingClip(pair);

		await pair.a.dispatch(clipA, "trim", { edge: "start", delta: 1 });
		pair.a.flushOutbound();
		await pair.waitForConvergence();

		expect(pair.b.ctx.getAttr(clipB, "start")).toBe(1);
		expect(pair.b.ctx.getAttr(clipB, "in")).toBe(1);
		expect(pair.b.ctx.getAttr(clipB, "duration")).toBe(3);
		pair.close();
	});

	it("keeps duplicate relay packets idempotent", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-duplicate"));

		await pair.a.dispatch(pair.a.project, "renameProject", "Duplicate-safe title");
		const ops = drainCrdtOutbox(pair.a.ctx.runtime);
		pair.transportA.sendOps({ ops });
		pair.transportA.sendOps({ ops });
		await pair.waitForConvergence();

		expect(pair.b.readProjectTitle()).toBe("Duplicate-safe title");
		expect(pair.relay.getRoomSnapshot("room-duplicate").log).toHaveLength(1);
		pair.close();
	});

	it("serves a bounded relay sync response for late catch-up", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-late-sync"));

		await pair.a.dispatch(pair.a.project, "renameProject", "Catch-up title");
		pair.a.flushOutbound();
		await pair.waitForConvergence();

		pair.transportB.requestSync("sync:late", {});
		await pair.waitForConvergence();

		expect(pair.transportB.received).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "crdt-sync-response",
					requestId: "sync:late",
					packet: expect.objectContaining({
						ops: expect.arrayContaining([
							expect.objectContaining({ name: "title" }),
						]),
					}),
				}),
			]),
		);
		pair.close();
	});
});
