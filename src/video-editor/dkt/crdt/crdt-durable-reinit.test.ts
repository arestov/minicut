import { indexedDB } from "fake-indexeddb";
import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { describe, expect, it } from "vitest";
import { bootDktModels, type DktTestContext } from "../testingInit";
import { drainCrdtOutbox, drainCrdtOutboxBatches } from "../test/crdtAssertions";
import { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import { createMiniCutRoomCrdtTransport } from "./createMiniCutRoomCrdtTransport";
import type { DktCrdtTransport } from "./testRelayContracts";

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
	const tracks = await Promise.all(
		(await ctx.queryRel(project, "tracks")).map(async (track) => ({
			track,
			kind: await ctx.queryAttr(track, "kind"),
		})),
	);
	const videoTrack = tracks.find((item) => item.kind === "video")?.track;
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
	transport: DktCrdtTransport | null = null,
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
			transport,
		},
	});
};

const waitForAttr = async (
	ctx: DktTestContext,
	model: Model,
	attrName: string,
	expected: unknown,
) => {
	const deadline = Date.now() + 2_000;
	let current = await ctx.queryAttr(model, attrName);
	while (current !== expected && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		await ctx.computed();
		current = await ctx.queryAttr(model, attrName);
	}
	expect(current).toBe(expected);
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
		await expect(restarted.queryAttr(restoredProject, "title")).resolves.toBe(
			"Before restart",
		);
		await expect(restarted.queryAttr(restoredClip, "duration")).resolves.toBe(4);
		expect(
			restarted.runtime.crdt_runtime?.testing?.peekDurableLog?.().length ?? 0,
		).toBeGreaterThanOrEqual(beforeRestartOps.length);

		await restarted.lockToRead(async () => {
			await restoredClip.dispatch("trim", { edge: "end", delta: -1 });
		});
		await expect(restarted.queryAttr(restoredClip, "duration")).resolves.toBe(3);
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

		await ctx.close();
		await restarted.close();
	});

	it("applies a remote op after reinit using restored model state", async () => {
		const relay = createInMemoryCrdtRelay();
		const targetTransport = createMiniCutRoomCrdtTransport({
			relay,
			roomId: "durable-reinit-transport",
			peerId: "durable-reinit-target",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		const target = await bootDktModels({
			crdt: {
				enabled: true,
				peerId: "durable-reinit-target",
				storage: createIndexedDbStorage(),
				transport: targetTransport,
			},
		});
		const { project: targetProject } = await createProjectWithClip(target);
		const sourceTransport = createMiniCutRoomCrdtTransport({
			relay,
			roomId: "durable-reinit-transport",
			peerId: "durable-reinit-source",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
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
				transport: sourceTransport,
			},
		});
		const sourceProject = findModel(sourceFromTarget, String(targetProject._node_id));
		const restartedTargetTransport = createMiniCutRoomCrdtTransport({
			relay,
			roomId: "durable-reinit-transport",
			peerId: "durable-reinit-target-restarted",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		const restartedTarget = await reinitContext(
			target,
			"durable-reinit-target-restarted",
			restartedTargetTransport,
		);
		const restoredTargetProject = findModel(
			restartedTarget,
			String(targetProject._node_id),
		);

		await sourceFromTarget.lockToRead(async () => {
			await sourceProject.dispatch("renameProject", "Remote after restart");
		});
		await waitForAttr(
			restartedTarget,
			restoredTargetProject,
			"title",
			"Remote after restart",
		);

		await target.close();
		await restartedTarget.close();
		await sourceFromTarget.close();
	});
});
