import { describe, expect, it } from "vitest";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";
import type { DktCrdtWireMessage } from "../crdt/testRelayContracts";

const pairOptions = (roomId: string) => ({
	roomId,
	profileId: "minicut-crdt-v1",
	profileVersion: 1,
});

const addMatchingClip = async (
	pair: Awaited<ReturnType<typeof createCrdtWorkerPair>>,
) => {
	await pair.a.dispatch(pair.a.videoTrack, "addClip", {
		name: "relay-fixture.webm",
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
	return { clipA, clipB };
};

describe("MiniCut CRDT relay convergence", () => {
	it("converges project attrs through the in-memory relay", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-project-attr"));

		await pair.a.dispatch(pair.a.project, "renameProject", "Relay title");
		pair.a.flushOutbound();
		await pair.waitForConvergence();

		await expect(pair.b.readProjectTitle()).resolves.toBe("Relay title");
		pair.close();
	});

	it("records a structural conflict when remote delete touches local clip activity", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-membership"));
		await addMatchingClip(pair);

		const clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
		if (!clipA) {
			throw new Error("Expected matching clip");
		}
		const originalClipIds = await pair.b.readVideoClipIds();

		await pair.a.dispatch(clipA, "removeSelf");
		pair.a.flushOutbound();
		await pair.waitForConvergence();

		await expect(pair.b.readVideoClipIds()).resolves.toEqual(originalClipIds);
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

		expect(pair.transportB.received).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "crdt-ops",
					packet: expect.objectContaining({
						payload: expect.objectContaining({
							batches: expect.arrayContaining([
								expect.objectContaining({
									ops: expect.arrayContaining([
										expect.objectContaining({ node_id: clipB._node_id, name: "start" }),
										expect.objectContaining({ node_id: clipB._node_id, name: "duration" }),
									]),
								}),
							]),
						}),
					}),
				}),
			]),
		);
		pair.close();
	});

	it("keeps duplicate relay packets idempotent", async () => {
		const pair = await createCrdtWorkerPair(pairOptions("room-duplicate"));
		const before = pair.relay.getRoomSnapshot("room-duplicate").log.length;

		await pair.a.dispatch(pair.a.project, "renameProject", "Duplicate-safe title");
		pair.a.flushOutbound();
		const afterFirstSend = pair.relay.getRoomSnapshot("room-duplicate").log;
		const sent = afterFirstSend.at(-1)
			?.payload as DktCrdtWireMessage | undefined;
		if (!sent) {
			throw new Error("Expected transport-delivered DKT payload");
		}
		pair.transportA.send(sent);
		await pair.waitForConvergence();

		await expect(pair.b.readProjectTitle()).resolves.toBe(
			"Duplicate-safe title",
		);
		expect(pair.relay.getRoomSnapshot("room-duplicate").log).toHaveLength(before + 1);
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
						payload: expect.objectContaining({
							batches: expect.arrayContaining([
								expect.objectContaining({
									ops: expect.arrayContaining([
										expect.objectContaining({ name: "title" }),
									]),
								}),
							]),
						}),
					}),
				}),
			]),
		);
		pair.close();
	});
});
