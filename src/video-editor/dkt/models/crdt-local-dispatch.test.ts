import { describe, expect, it } from "vitest";
import {
	runDktStorageRequest,
	type DktStorageRequest,
} from "../storage/dktStorageRequest";
import { bootDktModels, type DktTestContext } from "../testingInit";
import {
	drainCrdtOutbox,
	expectCrdtOutboxContains,
	expectNoCrdtStagedOps,
} from "../test/crdtAssertions";

type AnyModel = DktTestContext["sessionRoot"];

const createCrdtContext = async () => {
	const ctx = await bootDktModels({
		crdt: {
			enabled: true,
			peerId: `local-dispatch:${Math.random().toString(36).slice(2)}`,
			storage: "memory",
			transport: null,
		},
	});
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "CRDT local dispatch project",
		});
	});
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) {
		throw new Error("Expected active project");
	}
	const tracks = await ctx.queryRel(project, "tracks");
	const videoTrack = tracks.find((track) => ctx.getAttr(track, "kind") === "video");
	if (!videoTrack) {
		throw new Error("Expected video track");
	}
	drainCrdtOutbox(ctx.runtime);
	return { ctx, project, videoTrack };
};

const addClip = async (ctx: DktTestContext, videoTrack: AnyModel) => {
	await ctx.lockToRead(async () => {
		await videoTrack.dispatch("addClip", {
			name: "fixture-video.webm",
			mediaKind: "video",
			start: 0,
			in: 0,
			duration: 4,
		});
	});
	const clip = (await ctx.queryRel(videoTrack, "clips"))[0];
	if (!clip) {
		throw new Error("Expected clip");
	}
	return clip;
};

describe("MiniCut CRDT local dispatch staging", () => {
	it("does not publish owned media recovery task state or relations", async () => {
		const { ctx, project } = await createCrdtContext();
		await ctx.lockToRead(async () => {
			await project.dispatch("importResource", {
				name: "Local recovery source",
				kind: "video",
				url: "",
				mime: "video/webm",
				duration: 4,
			});
		});
		const resource = (await ctx.queryRel(project, "resources"))[0];
		if (!resource) throw new Error("Expected resource");
		drainCrdtOutbox(ctx.runtime);

		await ctx.lockToRead(async () => {
			await resource.dispatch("startMediaRecovery", {
				operationId: "operation:local",
				attemptId: "attempt:local",
				bootId: "boot:local",
				recoveryKind: "restore",
				intent: "restore",
				createdAt: 1,
				updatedAt: 1,
			});
		});

		expect(await ctx.queryRel(resource, "activeMediaRecoveryTask")).toHaveLength(1);
		expectNoCrdtStagedOps(ctx.runtime);
	});

	it("Project.setProjectTimestamps stages durable project metadata ops", async () => {
		const { ctx, project } = await createCrdtContext();

		await ctx.lockToRead(async () => {
			await project.dispatch("setProjectTimestamps", {
				createdAt: 101,
				updatedAt: 202,
			});
		});

		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, {
			kind: "attr",
			name: "createdAt",
			operation: "set",
			value: 101,
		});
		expectCrdtOutboxContains(ops, {
			kind: "attr",
			name: "updatedAt",
			operation: "set",
			value: 202,
		});
	});

	it("Project.renameProject creates an lww attr op", async () => {
		const { ctx, project } = await createCrdtContext();

		await ctx.lockToRead(async () => {
			await project.dispatch("renameProject", { title: "Renamed project" });
		});

		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, {
			kind: "attr",
			name: "title",
			operation: "set",
			value: "Renamed project",
		});
	});

	it("Track.addClip creates a sequence membership op", async () => {
		const { ctx, videoTrack } = await createCrdtContext();

		await addClip(ctx, videoTrack);

		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, {
			kind: "rel",
			name: "clips",
			operation: "insert",
		});
	});

	it("Track.moveClipWithinTrack creates a semantic sequence move op", async () => {
		const { ctx, videoTrack } = await createCrdtContext();
		const first = await addClip(ctx, videoTrack);
		await addClip(ctx, videoTrack);
		drainCrdtOutbox(ctx.runtime);

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("moveClipWithinTrack", {
				clipId: first._node_id,
				afterClipId: null,
			});
		});

		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, {
			kind: "rel",
			name: "clips",
			operation: "move",
			item_id: first._node_id,
			after_id: null,
		});
	});

	it("Clip.trim creates mvr timing ops", async () => {
		const { ctx, videoTrack } = await createCrdtContext();
		const clip = await addClip(ctx, videoTrack);
		drainCrdtOutbox(ctx.runtime);

		await ctx.lockToRead(async () => {
			await clip.dispatch("trim", { edge: "start", delta: 1 });
		});

		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, { kind: "attr", name: "start", value: 1 });
		expectCrdtOutboxContains(ops, { kind: "attr", name: "in", value: 1 });
		expectCrdtOutboxContains(ops, { kind: "attr", name: "duration", value: 3 });
	});

	it("Clip timing gesture previews locally and only publishes the final commit", async () => {
		const { ctx, videoTrack } = await createCrdtContext();
		const clip = await addClip(ctx, videoTrack);
		drainCrdtOutbox(ctx.runtime);

		await ctx.lockToRead(async () => {
			await clip.dispatch(
				"previewMoveBy",
				{ delta: 1 },
				null,
				{ intent: { batch_id: "clip-drag:test" } },
			);
		});

		expect(ctx.getAttr(clip, "start")).toBe(1);
		expect(drainCrdtOutbox(ctx.runtime)).toEqual([]);

		const dktStorage = ctx.storagePackage?.dktStorage as
			| {
					getSnapshot?: DktStorageRequest<{
						models?: Record<string, { attrs?: Record<string, unknown> }>;
					}>;
			  }
			| undefined;
		const previewSnapshot = dktStorage?.getSnapshot
			? await runDktStorageRequest(dktStorage.getSnapshot)
			: null;
		expect(previewSnapshot?.models?.[String(clip._node_id)]?.attrs?.start ?? 0)
			.toBe(0);

		await ctx.lockToRead(async () => {
			await clip.dispatch(
				"cleanupTimelineGesture",
				{ start: 0, in: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
				null,
				{ intent: { batch_id: "clip-drag:test" } },
			);
			await clip.dispatch(
				"commitTimelineAttrs",
				{ start: 1, in: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
				null,
				{ intent: { batch_id: "clip-drag:test" } },
			);
		});

		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, { kind: "attr", name: "start", value: 1 });
		const finalSnapshot = dktStorage?.getSnapshot
			? await runDktStorageRequest(dktStorage.getSnapshot)
			: null;
		expect(finalSnapshot?.models?.[String(clip._node_id)]?.attrs?.start).toBe(1);
	});

	it("Effect.setEffectParams creates an mvr params op", async () => {
		const { ctx, videoTrack } = await createCrdtContext();
		const clip = await addClip(ctx, videoTrack);
		await ctx.lockToRead(async () => {
			await clip.dispatch("addEffect", {
				kind: "blur",
				name: "Blur",
				params: { radius: 2 },
			});
		});
		const effect = (await ctx.queryRel(clip, "effects"))[0];
		if (!effect) {
			throw new Error("Expected effect");
		}
		drainCrdtOutbox(ctx.runtime);

		await ctx.lockToRead(async () => {
			await effect.dispatch("setEffectParams", { params: { radius: 8 } });
		});

		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, {
			kind: "attr",
			name: "params",
			value: { radius: 8 },
		});
	});

	it("patches params with a normal MVR write and keeps correction projection local", async () => {
		const { ctx, videoTrack } = await createCrdtContext();
		const clip = await addClip(ctx, videoTrack);
		await ctx.lockToRead(async () => {
			await clip.dispatch("addEffect", {kind: "blur", params: {unknown: {keep: 1}}});
		});
		const [effect] = await ctx.queryRel(clip, "effects");
		drainCrdtOutbox(ctx.runtime);
		await ctx.lockToRead(async () => {
			await effect.dispatch("patchEffectParams", {params: {exposure: {value: .2}}});
		});
		const ops = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(ops, {kind: "attr", name: "params", value: {unknown: {keep: 1}, exposure: {value: .2}}});
		expect(ops).toHaveLength(1);
		await ctx.lockToRead(async () => {
			await effect.dispatch("setEffectKind", {kind: "color-correction"});
		});
		expect(await ctx.queryRel(clip, "colorCorrectionEffects")).toEqual([effect]);
		expect(await ctx.queryAttr(clip, "$meta$rels$colorCorrectionEffects$exists")).toBe(true);
		const kindOps = drainCrdtOutbox(ctx.runtime);
		expectCrdtOutboxContains(kindOps, {kind: "attr", name: "kind", value: "color-correction"});
		expect(kindOps).toHaveLength(1);
	});

	it("SessionRoot.setCursor and import pipeline actions do not create durable CRDT ops", async () => {
		const { ctx, project } = await createCrdtContext();

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("setCursor", 2.5);
		});
		expectNoCrdtStagedOps(ctx.runtime);

		await ctx.lockToRead(async () => {
			await project.dispatch("requestImportFiles", {
				inputBatchHandleId: "input-batch:crdt-local",
			});
		});
		expectNoCrdtStagedOps(ctx.runtime);
	});
});
