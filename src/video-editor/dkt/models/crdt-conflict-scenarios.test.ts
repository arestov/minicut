import { describe, expect, it } from "vitest";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";

const createPairWithClip = async (roomId: string) => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	for (const peer of [pair.a, pair.b]) {
		await peer.dispatch(peer.videoTrack, "addClip", {
			name: "conflict-fixture.webm",
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
	return { pair, clipA, clipB };
};

const createPairWithClips = async (roomId: string, clipCount: number) => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	for (const peer of [pair.a, pair.b]) {
		for (let index = 0; index < clipCount; index += 1) {
			await peer.dispatch(peer.videoTrack, "addClip", {
				name: `conflict-fixture-${index}.webm`,
				mediaKind: "video",
				start: index * 4,
				in: 0,
				duration: 4,
			});
		}
		drainCrdtOutbox(peer.ctx.runtime);
	}
	const clipsA = await pair.a.ctx.queryRel(pair.a.videoTrack, "clips");
	const clipsB = await pair.b.ctx.queryRel(pair.b.videoTrack, "clips");
	expect(clipsA).toHaveLength(clipCount);
	expect(clipsB).toHaveLength(clipCount);
	expect(clipsA.map((clip) => clip._node_id)).toEqual(
		clipsB.map((clip) => clip._node_id),
	);
	return { pair, clipsA, clipsB };
};

const exchangeOps = async (
	pair: Awaited<ReturnType<typeof createCrdtWorkerPair>>,
	opsA: unknown[],
	opsB: unknown[],
) => {
	pair.transportA.sendOps({ ops: opsA });
	pair.transportB.sendOps({ ops: opsB });
	await pair.waitForConvergence();
};

const openConflictCount = (
	model: { getAttr?: (name: string) => unknown } | null | undefined,
	attrs: string[],
) =>
	Math.max(
		0,
		...attrs.map((attr) => {
			const value = model?.getAttr?.(attr);
			return typeof value === "number" ? value : Number(value ?? 0);
		}),
	);

const createTimingConflict = async (roomId: string) => {
	const { pair, clipA, clipB } = await createPairWithClip(roomId);

	await pair.a.dispatch(clipA, "resize", { edge: "end", delta: -1 });
	const opsA = drainCrdtOutbox(pair.a.ctx.runtime);
	await pair.b.dispatch(clipB, "resize", { edge: "end", delta: -2 });
	const opsB = drainCrdtOutbox(pair.b.ctx.runtime);

	await exchangeOps(pair, opsA, opsB);
	const conflictId =
		pair.a.ctx.getAttr(
			clipA,
			"$meta$aggregates$crdt$clipTiming$last_conflict_id",
		) ??
		pair.a.ctx.getAttr(
			clipA,
			"$meta$attrs$crdt$duration$last_conflict_id",
		) ??
		pair.a.ctx.getAttr(clipA, "$meta$model$crdt$last_conflict_id") ??
		"conflict:duration";

	return {
		pair,
		clipA,
		clipB,
		conflictId,
	};
};

describe("MiniCut CRDT conflict scenarios", () => {
	it("records generated meta for concurrent timing edits", async () => {
		const { pair, clipA, clipB } = await createTimingConflict(
			"room-conflict-timing",
		);

		expect(
			Number(
				pair.a.ctx.getAttr(
					clipA,
					"$meta$attrs$crdt$duration$open_conflicts_count",
				) ?? 0,
			),
		).toBeGreaterThan(0);
		expect(
			Number(
				pair.b.ctx.getAttr(
					clipB,
					"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
				) ?? 0,
			),
		).toBeGreaterThan(0);
		pair.close();
	});

	it("keeps timing conflict open and records failed attempt meta on invalid resolution", async () => {
		const { pair, clipA, conflictId } = await createTimingConflict(
			"room-conflict-timing-invalid-resolution",
		);
		const previousDuration = pair.a.ctx.getAttr(clipA, "duration");

		await pair.a.ctx.lockToRead(async () => {
			await clipA.dispatch(
				"resolveClipTimingConflict",
				{
					conflict_id: conflictId,
					start: 0,
					in: 0,
					duration: 0,
				},
				null,
				{
					crdt_resolution_attempt: {
						conflict_id: conflictId,
						aggregate: "clipTiming",
						model_id: clipA._node_id,
						model_name: "clip",
					},
				},
			);
		});

		expect(pair.a.ctx.getAttr(clipA, "duration")).toBe(previousDuration);
		expect(
			Number(
				pair.a.ctx.getAttr(
					clipA,
					"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
				) ?? 0,
			),
		).toBeGreaterThan(0);
		expect(
			pair.a.ctx.getAttr(
				clipA,
				"$meta$aggregates$crdt$clipTiming$last_resolution_error",
			),
		).toEqual(expect.objectContaining({ code: "duration_non_positive" }));
		pair.close();
	});

	it("resolves timing conflict through the domain action and clears generated meta", async () => {
		const { pair, clipA, conflictId } = await createTimingConflict(
			"room-conflict-timing-valid-resolution",
		);

		await pair.a.ctx.lockToRead(async () => {
			await clipA.dispatch(
				"resolveClipTimingConflict",
				{
					conflict_id: conflictId,
					start: 0,
					in: 0,
					duration: 3,
				},
				null,
				{
					crdt_resolution_attempt: {
						conflict_id: conflictId,
						aggregate: "clipTiming",
						model_id: clipA._node_id,
						model_name: "clip",
					},
				},
			);
		});

		expect(pair.a.ctx.getAttr(clipA, "duration")).toBe(3);
		expect(
			Number(
				pair.a.ctx.getAttr(
					clipA,
					"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
				) ?? 0,
			),
		).toBe(0);
		expect(
			pair.a.ctx.getAttr(
				clipA,
				"$meta$aggregates$crdt$clipTiming$last_resolution_error",
			) ?? null,
		).toBeNull();
		pair.close();
	});

	it("does not crash remote apply for concurrent clip reorders", async () => {
		const { pair, clipsA, clipsB } = await createPairWithClips(
			"room-conflict-move-vs-move",
			3,
		);

		await pair.a.dispatch(pair.a.videoTrack, "setClips", {
			clips: [clipsA[1], clipsA[0], clipsA[2]],
		});
		const opsA = drainCrdtOutbox(pair.a.ctx.runtime);
		await pair.b.dispatch(pair.b.videoTrack, "setClips", {
			clips: [clipsB[0], clipsB[2], clipsB[1]],
		});
		const opsB = drainCrdtOutbox(pair.b.ctx.runtime);

		await expect(exchangeOps(pair, opsA, opsB)).resolves.toBeUndefined();
		pair.close();
	});

	it("records structural conflict meta for delete vs effect edit", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
			"room-conflict-delete-vs-effect-edit",
		);
		await pair.a.dispatch(clipA, "addEffect", {
			kind: "blur",
			name: "Blur",
			params: { radius: 2 },
		});
		await pair.b.dispatch(clipB, "addEffect", {
			kind: "blur",
			name: "Blur",
			params: { radius: 2 },
		});
		drainCrdtOutbox(pair.a.ctx.runtime);
		drainCrdtOutbox(pair.b.ctx.runtime);
		const effectA = (await pair.a.ctx.queryRel(clipA, "effects"))[0];
		if (!effectA) {
			throw new Error("Expected effect fixture");
		}

		await pair.a.dispatch(effectA, "setEffectParams", { params: { radius: 8 } });
		drainCrdtOutbox(pair.a.ctx.runtime);
		await pair.b.dispatch(clipB, "removeSelf");
		const opsB = drainCrdtOutbox(pair.b.ctx.runtime);

		pair.transportB.sendOps({ ops: opsB });
		await pair.waitForConvergence();

		expect(
			openConflictCount(pair.a.videoTrack, [
				"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
				"$meta$rels$crdt$clips$open_conflicts_count",
				"$meta$model$crdt$open_conflicts_count",
			]),
		).toBeGreaterThan(0);
		pair.close();
	});

	it("records structural conflict meta for split vs delete", async () => {
		const { pair, clipA, clipB } = await createPairWithClip(
			"room-conflict-split-vs-delete",
		);

		await pair.a.dispatch(clipA, "splitSelfAt", { time: 2 });
		drainCrdtOutbox(pair.a.ctx.runtime);
		await pair.b.dispatch(clipB, "removeSelf");
		const opsB = drainCrdtOutbox(pair.b.ctx.runtime);

		pair.transportB.sendOps({ ops: opsB });
		await pair.waitForConvergence();

		expect(
			openConflictCount(pair.a.videoTrack, [
				"$meta$rels$crdt$clips$open_conflicts_count",
				"$meta$model$crdt$open_conflicts_count",
			]),
		).toBeGreaterThan(0);
		pair.close();
	});
});
