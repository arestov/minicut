import { describe, expect, it } from "vitest";
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
