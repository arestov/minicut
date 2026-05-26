import { describe, expect, it } from "vitest";
import { sanitizeStorageValue } from "../crdt/sanitizeStoragePackage";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";

const pairOptions = (roomId: string) => ({
	roomId,
	profileId: "minicut-crdt-v1",
	profileVersion: 1,
});

const importVideoAndAddToTimeline = async (
	pair: Awaited<ReturnType<typeof createCrdtWorkerPair>>,
) => {
	await pair.a.dispatch(pair.a.project, "importResource", {
		name: "wire-video.webm",
		kind: "video",
		url: "https://example.invalid/wire-video.webm",
		mime: "video/webm",
		duration: 5,
		size: 500,
		source: { kind: "local" },
		status: "ready",
		data: { status: "ready" },
	});

	const resources = await pair.a.ctx.queryRel(pair.a.project, "resources");
	const resource = resources.find(
		(item) => pair.a.ctx.getAttr(item, "name") === "wire-video.webm",
	);
	if (!resource?._node_id) {
		throw new Error("Expected imported wire-video resource");
	}

	await pair.a.dispatch(
		pair.a.project,
		"addResourceToTimeline",
		resource._node_id,
	);
};

const jsonRoundTrip = <T>(value: T): T =>
	JSON.parse(JSON.stringify(value)) as T;

const batchOps = (batches: unknown[]): Array<Record<string, unknown>> =>
	batches.flatMap((batch) =>
		((batch as { ops?: unknown[] } | null)?.ops ?? []).filter(
			(op): op is Record<string, unknown> =>
				Boolean(op && typeof op === "object"),
		),
	);

const allOpsHaveClock = (batches: unknown[]): boolean =>
	batchOps(batches).every((op) => Boolean(op.clock));

const readRelayBatches = (
	pair: Awaited<ReturnType<typeof createCrdtWorkerPair>>,
	roomId: string,
): unknown[] =>
	pair.relay
		.getRoomSnapshot(roomId)
		.log.flatMap((packet) => packet.payload.batches);

describe("MiniCut CRDT browser-like wire batches", () => {
	it("keeps graph batches JSON-serializable before browser-style receive", async () => {
		const roomId = "wire-json-roundtrip";
		const pair = await createCrdtWorkerPair(pairOptions(roomId));

		await importVideoAndAddToTimeline(pair);
		await pair.waitForConvergence();
		const rawBatches = readRelayBatches(pair, roomId);

		expect(rawBatches.length).toBeGreaterThan(0);
		expect(allOpsHaveClock(rawBatches)).toBe(true);
		expect(() => JSON.stringify(rawBatches)).not.toThrow();

		const wireBatches = jsonRoundTrip(rawBatches);
		expect(allOpsHaveClock(wireBatches)).toBe(true);

		const targetResource = (await pair.b.ctx.queryRel(pair.b.project, "resources"))
			.find((item) => pair.b.ctx.getAttr(item, "name") === "wire-video.webm");
		expect(targetResource?._node_id).toBeTruthy();
		const clips = await pair.b.queryVideoClips();
		expect(
			clips.some((clip) => pair.b.ctx.getAttr(clip, "name") === "wire-video.webm"),
		).toBe(true);

		pair.close();
	});

	it("does not drop op clocks when using the current debug sanitize boundary", async () => {
		const roomId = "wire-sanitize-roundtrip";
		const pair = await createCrdtWorkerPair(pairOptions(roomId));

		await importVideoAndAddToTimeline(pair);
		await pair.waitForConvergence();
		const rawBatches = readRelayBatches(pair, roomId);
		const sanitizedBatches = sanitizeStorageValue(rawBatches) as unknown[];

		expect(rawBatches.length).toBeGreaterThan(0);
		expect(allOpsHaveClock(rawBatches)).toBe(true);
		expect(allOpsHaveClock(sanitizedBatches)).toBe(true);

		pair.close();
	});
});
