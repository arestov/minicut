import { indexedDB } from "fake-indexeddb";
import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { describe, expect, it } from "vitest";
import { bootDktModels, type DktTestContext } from "../testingInit";
import { drainCrdtOutbox, drainCrdtOutboxBatches } from "../test/crdtAssertions";

type Model = DktTestContext["sessionRoot"];

const createIndexedDbStorage = () => ({
	type: "indexeddb" as const,
	dbName: `minicut-crdt-reinit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	indexedDB,
});

const createProjectWithClip = async (ctx: DktTestContext) => {
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "Durable reinit project",
		});
	});
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected active project");
	const videoTrack = (await ctx.queryRel(project, "tracks")).find(
		(track) => ctx.getAttr(track, "kind") === "video",
	);
	if (!videoTrack) throw new Error("Expected video track");
	await ctx.lockToRead(async () => {
		await videoTrack.dispatch("addClip", {
			name: "durable-reinit.webm",
			mediaKind: "video",
			start: 0,
			in: 0,
			duration: 4,
		});
	});
	const clip = (await ctx.queryRel(videoTrack, "clips"))[0];
	if (!clip) throw new Error("Expected clip");
	drainCrdtOutbox(ctx.runtime);
	return { project, videoTrack, clip };
};

const reinitContext = async (
	ctx: DktTestContext,
	peerId: string,
): Promise<DktTestContext> => {
	const dktStorage = ctx.storagePackage?.dktStorage as {
		getSnapshot?: () => Promise<unknown>;
	};
	const snapshot = await dktStorage.getSnapshot?.();
	if (!snapshot) throw new Error("Expected DKT storage snapshot");
	return bootDktModels({
		reinitFromSnapshot: snapshot,
		crdt: {
			enabled: true,
			peerId,
			storage: ctx.storagePackage ?? "memory",
			transport: null,
		},
	});
};

const findModel = (ctx: DktTestContext, id: string): Model => {
	const model = getModelById(ctx.sessionRoot, id) as Model | null;
	if (!model) throw new Error(`Expected restored model ${id}`);
	return model;
};

describe("MiniCut CRDT durable reinit", () => {
	it("restores graph and durable CRDT log, then continues editing", async () => {
		const ctx = await bootDktModels({
			crdt: {
				enabled: true,
				peerId: "durable-reinit-a",
				storage: createIndexedDbStorage(),
				transport: null,
			},
		});
		const { project, clip } = await createProjectWithClip(ctx);
		const projectId = String(project._node_id);
		const clipId = String(clip._node_id);

		await ctx.lockToRead(async () => {
			await project.dispatch("renameProject", "Before restart");
		});
		const beforeRestartOps =
			ctx.runtime.crdt_runtime?.testing?.peekDurableLog?.() ?? [];
		expect(beforeRestartOps.length).toBeGreaterThan(0);

		const restarted = await reinitContext(ctx, "durable-reinit-a");
		const restoredProject = findModel(restarted, projectId);
		const restoredClip = findModel(restarted, clipId);
		expect(restarted.getAttr(restoredProject, "title")).toBe("Before restart");
		expect(restarted.getAttr(restoredClip, "duration")).toBe(4);
		expect(
			restarted.runtime.crdt_runtime?.testing?.peekDurableLog?.().length ?? 0,
		).toBeGreaterThanOrEqual(beforeRestartOps.length);

		await restarted.lockToRead(async () => {
			await restoredClip.dispatch("trim", { edge: "end", delta: -1 });
		});
		expect(restarted.getAttr(restoredClip, "duration")).toBe(3);
		const batches = drainCrdtOutboxBatches(restarted.runtime);
		expect(drainCrdtOutbox(restarted.runtime)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "attr", name: "duration", value: 3 }),
			]),
		);
		expect(batches).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					ops: expect.arrayContaining([
						expect.objectContaining({ kind: "attr", name: "duration", value: 3 }),
					]),
				}),
			]),
		);

		await restarted.close();
	});

	it("applies a remote op after reinit using restored model state", async () => {
		const source = await bootDktModels({
			crdt: {
				enabled: true,
				peerId: "durable-reinit-source",
				storage: "memory",
				transport: null,
			},
		});
		const target = await bootDktModels({
			crdt: {
				enabled: true,
				peerId: "durable-reinit-target",
				storage: createIndexedDbStorage(),
				transport: null,
			},
		});
		const { project: targetProject } = await createProjectWithClip(target);
		const targetSnapshot = await (
			target.storagePackage?.dktStorage as { getSnapshot?: () => Promise<unknown> }
		)?.getSnapshot?.();
		if (!targetSnapshot) throw new Error("Expected target snapshot");
		const sourceFromTarget = await bootDktModels({
			reinitFromSnapshot: targetSnapshot,
			crdt: {
				enabled: true,
				peerId: "durable-reinit-source",
				storage: "memory",
				transport: null,
			},
		});
		const sourceProject = findModel(sourceFromTarget, String(targetProject._node_id));

		await sourceFromTarget.lockToRead(async () => {
			await sourceProject.dispatch("renameProject", "Remote after restart");
		});
		const batches = drainCrdtOutboxBatches(sourceFromTarget.runtime);
		drainCrdtOutbox(sourceFromTarget.runtime);
		const restartedTarget = await reinitContext(
			target,
			"durable-reinit-target",
		);
		const restoredTargetProject = findModel(
			restartedTarget,
			String(targetProject._node_id),
		);

		for (const batch of batches) {
			await restartedTarget.runtime.crdt_runtime?.receiveCanonicalBatch?.(
				restoredTargetProject,
				batch,
			);
		}
		await restartedTarget.computed();

		expect(restartedTarget.getAttr(restoredTargetProject, "title")).toBe(
			"Remote after restart",
		);

		await restartedTarget.close();
		await sourceFromTarget.close();
		await source.close();
	});
});
