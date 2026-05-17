import { describe, expect, it } from "vitest";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import { dispatchClipTimingResizeGesture } from "../test/clipTimingGesture";
import { createCrdtWorkerPair } from "../test/createCrdtWorkerPair";

const createPairWithClip = async (roomId: string) => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	await pair.a.dispatch(pair.a.videoTrack, "addClip", {
		name: "conflict-fixture.webm",
		mediaKind: "video",
		start: 0,
		in: 0,
		duration: 4,
	});
	await pair.syncBaselineFrom("A");
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
	for (let index = 0; index < clipCount; index += 1) {
		await pair.a.dispatch(pair.a.videoTrack, "addClip", {
			name: `conflict-fixture-${index}.webm`,
			mediaKind: "video",
			start: index * 4,
			in: 0,
			duration: 4,
		});
	}
	await pair.syncBaselineFrom("A");
	const clipsA = await pair.a.ctx.queryRel(pair.a.videoTrack, "clips");
	const clipsB = await pair.b.ctx.queryRel(pair.b.videoTrack, "clips");
	expect(clipsA).toHaveLength(clipCount);
	expect(clipsB).toHaveLength(clipCount);
	expect(clipsA.map((clip) => clip._node_id)).toEqual(
		clipsB.map((clip) => clip._node_id),
	);
	return { pair, clipsA, clipsB };
};

const findTrackByKind = async (
	peer: Awaited<ReturnType<typeof createCrdtWorkerPair>>["a"],
	kind: string,
) => {
	const tracks = await peer.ctx.queryRel(peer.project, "tracks");
	const trackKinds = await Promise.all(
		tracks.map(async (track) => ({
			track,
			kind: await peer.ctx.queryAttr(track, "kind"),
		})),
	);
	const track = trackKinds.find((item) => item.kind === kind)?.track;
	if (!track) {
		throw new Error(`Expected ${kind} track`);
	}
	return track;
};

const createPairWithTextClip = async (roomId: string) => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	await pair.a.dispatch(pair.a.videoTrack, "addTextClip", {
		name: "Text conflict",
		mediaKind: "text",
		start: 0,
		in: 0,
		duration: 4,
		text: { content: "Original title" },
	});
	await pair.syncBaselineFrom("A");
	let clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
	if (!clipA) {
		throw new Error("Expected source clip");
	}
	await pair.a.dispatch(clipA, "trim", { edge: "end", delta: -0.1 });
	await pair.a.dispatch(clipA, "trim", { edge: "end", delta: 0.1 });
	await pair.syncBaselineFrom("A");
	clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
	const clipB = (await pair.b.ctx.queryRel(pair.b.videoTrack, "clips"))[0];
	if (!clipA || !clipB) {
		throw new Error("Expected matching text clips");
	}
	const textA = (await pair.a.ctx.queryRel(clipA, "text"))[0];
	const textB = (await pair.b.ctx.queryRel(clipB, "text"))[0];
	if (!textA || !textB) {
		throw new Error("Expected matching text nodes");
	}
	expect(clipA._node_id).toBe(clipB._node_id);
	expect(textA._node_id).toBe(textB._node_id);
	return { pair, clipA, clipB, textA, textB };
};

const createPairWithResourceClip = async (roomId: string) => {
	const pair = await createCrdtWorkerPair({
		roomId,
		profileId: "minicut-crdt-v1",
		profileVersion: 1,
	});
	await pair.a.dispatch(pair.a.project, "importResource", {
		name: "dangling-resource.webm",
		kind: "video",
		url: "memory://dangling-resource.webm",
		mime: "video/webm",
		duration: 4,
		status: "ready",
	});
	const resource = (await pair.a.ctx.queryRel(pair.a.project, "resources"))[0];
	if (!resource) {
		throw new Error("Expected resource fixture");
	}
	await pair.a.dispatch(pair.a.videoTrack, "addClip", {
		name: "dangling-resource-clip.webm",
		mediaKind: "video",
		start: 0,
		in: 0,
		duration: 4,
	});
	const clip = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
	if (!clip) {
		throw new Error("Expected clip fixture");
	}
	await pair.a.dispatch(clip, "setResource", { resource });
	await pair.syncBaselineFrom("A");
	const resourceA = (await pair.a.ctx.queryRel(pair.a.project, "resources"))[0];
	const resourceB = (await pair.b.ctx.queryRel(pair.b.project, "resources"))[0];
	const clipA = (await pair.a.ctx.queryRel(pair.a.videoTrack, "clips"))[0];
	const clipB = (await pair.b.ctx.queryRel(pair.b.videoTrack, "clips"))[0];
	if (!resourceA || !resourceB || !clipA || !clipB) {
		throw new Error("Expected matching resource clip fixtures");
	}
	expect(resourceA._node_id).toBe(resourceB._node_id);
	expect(clipA._node_id).toBe(clipB._node_id);
	return { pair, resourceA, resourceB, clipA, clipB };
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

	await pair.a.ctx.lockToRead(async () => {
		await dispatchClipTimingResizeGesture(pair.a.ctx, clipA, {
			edge: "end",
			delta: -1,
			batchId: `${roomId}:A:resize`,
		});
	});
	const opsA = drainCrdtOutbox(pair.a.ctx.runtime);
	await pair.b.ctx.lockToRead(async () => {
		await dispatchClipTimingResizeGesture(pair.b.ctx, clipB, {
			edge: "end",
			delta: -2,
			batchId: `${roomId}:B:resize`,
		});
	});
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
	it.skip("records generated meta for concurrent timing edits", async () => {
		// TODO: unskip when the shared snapshot baseline also seeds the CRDT
		// sidecar state for clipTiming creation attrs. Without that baseline,
		// this would test a fixture shortcut instead of real replicated history.
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

	it.skip("keeps timing conflict open and records failed attempt meta on invalid resolution", async () => {
		// TODO: depends on the real clipTiming sidecar baseline described above.
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

	it.skip("resolves timing conflict through the domain action and clears generated meta", async () => {
		// TODO: depends on the real clipTiming sidecar baseline described above.
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

	it("records relation conflict meta for concurrent semantic clip moves", async () => {
		const { pair, clipsA, clipsB } = await createPairWithClips(
			"room-conflict-move-vs-move",
			3,
		);

		await pair.a.dispatch(pair.a.videoTrack, "moveClipWithinTrack", {
			clipId: clipsA[1]?._node_id,
			afterClipId: null,
		});
		const opsA = drainCrdtOutbox(pair.a.ctx.runtime);
		await pair.b.dispatch(pair.b.videoTrack, "moveClipWithinTrack", {
			clipId: clipsB[1]?._node_id,
			afterClipId: clipsB[2]?._node_id,
		});
		const opsB = drainCrdtOutbox(pair.b.ctx.runtime);

		await exchangeOps(pair, opsA, opsB);

		expect(
			openConflictCount(pair.a.videoTrack, [
				"$meta$rels$crdt$clips$open_conflicts_count",
				"$meta$model$crdt$open_conflicts_count",
			]),
		).toBeGreaterThan(0);
		pair.close();
	});

	it("records structural conflict meta for delete vs effect edit", async () => {
		const { pair, clipA } = await createPairWithClip(
			"room-conflict-delete-vs-effect-edit",
		);
		await pair.a.dispatch(clipA, "addEffect", {
			kind: "blur",
			name: "Blur",
			params: { radius: 2 },
		});
		await pair.syncBaselineFrom("A");
		const clipB = (await pair.b.ctx.queryRel(pair.b.videoTrack, "clips"))[0];
		if (!clipB) {
			throw new Error("Expected synced clip on peer B");
		}
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

	it("records structural conflict meta for delete vs text edit", async () => {
		const { pair, clipA, clipB, textA } = await createPairWithTextClip(
			"room-conflict-delete-vs-text-edit",
		);

		await pair.a.dispatch(textA, "setTextContent", "Remote title edit");
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
		expect((await pair.a.ctx.queryRel(clipA, "text"))[0]?._node_id).toBe(
			textA._node_id,
		);
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

	it("records owner-slot conflict meta for concurrent moves to different tracks", async () => {
		const { pair, clipsA, clipsB } = await createPairWithClips(
			"room-conflict-owner-slot-cross-track",
			2,
		);
		const audioTrackA = await findTrackByKind(pair.a, "audio");
		const clipId = clipsA[0]?._node_id;
		if (!clipId) {
			throw new Error("Expected clip fixture");
		}

		await pair.a.dispatch(pair.a.project, "moveClipToTrack", {
			clipId,
			targetTrackId: audioTrackA._node_id,
		});
		const opsA = drainCrdtOutbox(pair.a.ctx.runtime);

		await pair.b.dispatch(pair.b.videoTrack, "moveClipWithinTrack", {
			clipId: clipsB[0]?._node_id,
			afterClipId: clipsB[1]?._node_id,
		});
		const opsB = drainCrdtOutbox(pair.b.ctx.runtime);

		await exchangeOps(pair, opsA, opsB);

		expect(
			openConflictCount(clipsB[0], [
				"$meta$rels$crdt$track$open_conflicts_count",
				"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
				"$meta$model$crdt$open_conflicts_count",
			]),
		).toBeGreaterThan(0);
		expect(await pair.a.ctx.queryRel(pair.a.videoTrack, "clips")).not.toContain(
			clipsA[0],
		);
		expect(await pair.a.ctx.queryRel(audioTrackA, "clips")).toContain(clipsA[0]);
		pair.close();
	});

	it("records dangling resource ref conflict meta for resource tombstone", async () => {
		const { pair, resourceA, resourceB, clipA } =
			await createPairWithResourceClip("room-conflict-dangling-resource-ref");

		expect((await pair.a.ctx.queryRel(clipA, "resource"))[0]?._node_id).toBe(
			resourceA._node_id,
		);

		await pair.b.dispatch(resourceB, "removeSelf");
		const opsB = drainCrdtOutbox(pair.b.ctx.runtime);
		pair.transportB.sendOps({ ops: opsB });
		await pair.waitForConvergence();

		expect(
			openConflictCount(resourceA, [
				"$meta$aggregates$crdt$resourceLifecycle$open_conflicts_count",
				"$meta$model$crdt$open_conflicts_count",
			]),
		).toBeGreaterThan(0);
		expect(pair.a.ctx.getAttr(resourceA, "$meta$removed") ?? false).toBe(false);
		expect((await pair.a.ctx.queryRel(clipA, "resource"))[0]?._node_id).toBe(
			resourceA._node_id,
		);
		pair.close();
	});
});
