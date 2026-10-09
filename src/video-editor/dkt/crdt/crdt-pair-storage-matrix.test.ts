import { describe, expect, it } from "vitest";
import { queryAddr } from "dkt/async/queryAddr.js";
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
		/** Join an existing document: receive the other peer's CRDT history. */
		syncFromRelay?: boolean;
		storage?: MiniCutDktCrdtStorageOptions;
		transport: DktCrdtTransport & {
			requestSync?: (requestId: string) => void;
		};
	},
) => {
	const ctx = await bootDktModels({
		crdt: {
			enabled: true,
			peerId,
			storage: options.storage ?? storageForPeer(profile, peerId),
			transport: options.transport,
		},
		unloadModels: false,
	});
	if (options.syncFromRelay) {
		options.transport.requestSync?.(`storage-matrix-bootstrap-${peerId}`);
		await (
			ctx.runtime.crdt_runtime as {
				transport_receive_tail?: Promise<unknown>;
			} | null
		)?.transport_receive_tail;
		await ctx.computed();
		const projects = await ctx.queryRel(ctx.appModel, "project");
		const projectInfos = await Promise.all(
			projects.map(async (project) => ({
				project,
				title: await ctx.queryAttr(project, "title"),
			})),
		);
		const project = projectInfos.find((item) => item.title === "Pair A")?.project;
		if (!project) throw new Error("Expected project from synced CRDT history");
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
			const transportB = createMiniCutRoomCrdtTransport({
				relay,
				roomId,
				peerId: "B",
				profileId: "minicut-crdt-v1",
				profileVersion: 1,
			});
			const b = await createPeer("B", profile, {
				syncFromRelay: true,
				storage: bStorage,
				transport: transportB,
			});
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
