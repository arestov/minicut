import { describe, expect, it } from "vitest";
import { queryAddr } from "dkt/async/queryAddr.js";
import { toReinitableData } from "dkt/runtime/app/reinit.js";
import { bootDktModels, type DktTestContext } from "../testingInit";
import { createMiniCutCrdtStorageProfiles } from "../test/crdtStorageMatrix";
import type { MiniCutDktCrdtStorageOptions } from "../testingInit";
import type { MiniCutCrdtStorageProfile } from "../test/crdtStorageMatrix";
import { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import { createMiniCutRoomCrdtTransport } from "./createMiniCutRoomCrdtTransport";
import type { DktCrdtTransport } from "./testRelayContracts";

type Model = DktTestContext["sessionRoot"];

const queryAddrLoose = queryAddr as unknown as (
	model: Model,
	addr: string,
) => Promise<unknown>;

const findVideoTrack = async (ctx: DktTestContext, project: Model) => {
	const tracksFromRel = await ctx.queryRel(project, "tracks");
	const tracksFromAddr = (await queryAddrLoose(
		project,
		"<< @all:tracks",
	)) as Model[];
	const tracks = tracksFromRel.length > 0 ? tracksFromRel : tracksFromAddr;
	const trackKinds = await Promise.all(
		tracks.map(async (track) => ({
			track,
			kind: await ctx.queryAttr(track, "kind"),
		})),
	);
	const videoTrack = trackKinds.find((item) => item.kind === "video")?.track;
	if (!videoTrack) {
		throw new Error(
			`Expected video track: ${JSON.stringify({
				project: project._node_id,
				tracksFromRel: tracksFromRel.map((track) => track?._node_id),
				tracksFromAddr: tracksFromAddr.map((track) => track?._node_id),
				trackKinds: trackKinds.map((item) => ({
					id: item.track?._node_id,
					kind: item.kind,
					modelName: item.track?.model_name,
				})),
			})}`,
		);
	}
	return videoTrack;
};

const reloadProjectById = async (ctx: DktTestContext, projectId: string) => {
	const projects = await ctx.queryRel(ctx.appModel, "project");
	const project = projects.find((item) => item._node_id === projectId);
	if (!project) throw new Error(`Expected project ${projectId}`);
	return project;
};

const storageForPeer = (
	profile: MiniCutCrdtStorageProfile,
	peerId: string,
): MiniCutDktCrdtStorageOptions => {
	const { storage } = profile;
	if (storage === "memory") {
		return storage;
	}
	if ("type" in storage && storage.type === "memory") {
		return storage;
	}
	if ("type" in storage && storage.type === "indexeddb") {
		return { ...storage, dbName: `${storage.dbName}-${peerId}` };
	}
	return storage;
};

const createPeer = async (
	peerId: string,
	profile: MiniCutCrdtStorageProfile,
	options: {
		snapshot?: unknown;
		storage?: MiniCutDktCrdtStorageOptions;
		transport: DktCrdtTransport;
	} = {},
) => {
	const ctx = await bootDktModels({
		reinitFromSnapshot: options.snapshot,
		crdt: {
			enabled: true,
			peerId,
			storage: options.storage ?? storageForPeer(profile, peerId),
			transport: options.transport,
		},
		unloadModels: false,
	});
	if (options.snapshot) {
		const projects = await ctx.queryRel(ctx.appModel, "project");
		const projectInfos = await Promise.all(
			projects.map(async (project) => ({
				project,
				title: await ctx.queryAttr(project, "title"),
				tracks: await ctx.queryRel(project, "tracks"),
			})),
		);
		const project =
			projectInfos.find((item) => item.title === "Pair A")?.project ??
			projectInfos.find((item) => item.tracks.length > 0)?.project ??
			projects[0];
		if (!project) throw new Error("Expected snapshot project");
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("syncActiveProjectRel", { project });
		});
	} else {
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("createProject", {
				title: `Pair ${peerId}`,
			});
		});
	}
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected project");
	const videoTrack = await findVideoTrack(ctx, project);
	return { ctx, project, videoTrack };
};

const seedDktSnapshot = async (ctx: DktTestContext, snapshot: unknown) => {
	const dktStorage = ctx.storagePackage?.dktStorage as
		| {
				putSchema?: (schema: unknown) => Promise<unknown> | unknown;
				createModel?: (
					id: string,
					modelName: string,
					attrs?: Record<string, unknown>,
					rels?: Record<string, unknown>,
					mentions?: Record<string, unknown>,
				) => Promise<unknown> | unknown;
				createExpectedRel?: (
					key: string,
					data: unknown,
				) => Promise<unknown> | unknown;
				commitChanges?: (meta?: unknown) => Promise<unknown> | unknown;
			}
		| undefined;
	if (!dktStorage) return;
	const data = snapshot as {
		models?: Record<
			string,
			{
				id?: string;
				model_name?: string;
				attrs?: Record<string, unknown>;
				rels?: Record<string, unknown>;
				mentions?: Record<string, unknown>;
			}
		>;
		expected_rels_to_chains?: Record<string, unknown>;
	};
	const models = Object.entries(data.models ?? {});
	const schema: Record<
		string,
		{ attrs: Array<{ name: string }>; rels: Array<{ name: string }> }
	> = {};
	for (const [, model] of models) {
		const modelName = model.model_name;
		if (!modelName) continue;
		const entry = (schema[modelName] ??= { attrs: [], rels: [] });
		const attrNames = new Set(entry.attrs.map((attr) => attr.name));
		const relNames = new Set(entry.rels.map((rel) => rel.name));
		for (const name of Object.keys(model.attrs ?? {})) {
			if (!attrNames.has(name)) {
				entry.attrs.push({ name });
				attrNames.add(name);
			}
		}
		for (const name of Object.keys(model.rels ?? {})) {
			if (!relNames.has(name)) {
				entry.rels.push({ name });
				relNames.add(name);
			}
		}
	}
	await dktStorage.putSchema?.(schema);
	for (const [fallbackId, model] of models) {
		if (!model.model_name) continue;
		await dktStorage.createModel?.(
			model.id ?? fallbackId,
			model.model_name,
			model.attrs ?? {},
			model.rels ?? {},
			model.mentions ?? {},
		);
	}
	for (const [key, value] of Object.entries(data.expected_rels_to_chains ?? {})) {
		await dktStorage.createExpectedRel?.(key, value);
	}
	await dktStorage.commitChanges?.({ reason: "minicut-storage-matrix-snapshot" });
};

const addClip = async (ctx: DktTestContext, videoTrack: Model) => {
	await ctx.lockToRead(async () => {
		await videoTrack.dispatch("addClip", {
			name: "storage-matrix.webm",
			mediaKind: "video",
			start: 0,
			in: 0,
			duration: 4,
		});
	});
	const clip = (await ctx.queryRel(videoTrack, "clips"))[0];
	if (!clip) throw new Error("Expected clip");
	return clip;
};

const flushTransportOutbox = (ctx: DktTestContext) => {
	(ctx.runtime.crdt_runtime as { flushTransportOutbox?: () => unknown } | null)
		?.flushTransportOutbox?.();
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

describe("MiniCut CRDT pair storage matrix", () => {
	for (const profile of createMiniCutCrdtStorageProfiles()) {
		it(`applies mapped timing edits with ${profile.name}`, async () => {
			const relay = createInMemoryCrdtRelay();
			const roomId = `storage-matrix-${profile.name}`;
			const transportA = createMiniCutRoomCrdtTransport({
				relay,
				roomId,
				peerId: "A",
				profileId: "minicut-crdt-v1",
				profileVersion: 1,
			});
			const a = await createPeer("A", profile, { transport: transportA });
			const clipA = await addClip(a.ctx, a.videoTrack);
			flushTransportOutbox(a.ctx);
			const bStorage = storageForPeer(profile, "B");
			const snapshot = await toReinitableData(a.ctx.runtime);
			const transportB = createMiniCutRoomCrdtTransport({
				relay,
				roomId,
				peerId: "B",
				profileId: "minicut-crdt-v1",
				profileVersion: 1,
			});
			const b = await createPeer("B", profile, {
				snapshot,
				storage: bStorage,
				transport: transportB,
			});
			await seedDktSnapshot(b.ctx, snapshot);
			await b.ctx.runtime.crdt_runtime?.restoreFromStorage?.();
			await b.ctx.computed();
			let clipB = (await b.ctx.queryRel(b.videoTrack, "clips"))[0];
			if (!clipB) throw new Error("Expected synced clip");
			if (profile.unloadModels) {
				(b.ctx.runtime as { enableUnload?: () => void }).enableUnload?.();
				await b.ctx.computed();
				const project = (await b.ctx.queryRel(b.ctx.sessionRoot, "activeProject"))[0];
				if (!project) throw new Error("Expected lazy active project");
				const videoTrack = await findVideoTrack(
					b.ctx,
					await reloadProjectById(b.ctx, String(project._node_id)),
				);
				clipB = (await b.ctx.queryRel(videoTrack, "clips"))[0];
				if (!clipB) throw new Error("Expected lazy synced clip");
			}

			transportB.setDeliveryPaused(true);
			await a.ctx.lockToRead(async () => {
				await clipA.dispatch("trim", { edge: "start", delta: 1 });
			});
			flushTransportOutbox(a.ctx);
			transportB.setDeliveryPaused(false);
			transportB.flushBufferedMessages();

			await waitForAttr(b.ctx, clipB, "start", 1);
			await waitForAttr(b.ctx, clipB, "in", 1);
			await waitForAttr(b.ctx, clipB, "duration", 3);
			await a.ctx.close();
			await b.ctx.close();
		});
	}
});
