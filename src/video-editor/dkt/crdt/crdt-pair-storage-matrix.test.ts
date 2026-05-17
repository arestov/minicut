import { describe, expect, it } from "vitest";
import { bootDktModels, type DktTestContext } from "../testingInit";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import { createMiniCutCrdtStorageProfiles } from "../test/crdtStorageMatrix";
import type { MiniCutDktCrdtStorageOptions } from "../testingInit";
import type { MiniCutCrdtStorageProfile } from "../test/crdtStorageMatrix";

type Model = DktTestContext["sessionRoot"];

const storageForPeer = (
	profile: MiniCutCrdtStorageProfile,
	peerId: string,
): MiniCutDktCrdtStorageOptions => {
	if (profile.storage === "memory" || profile.storage.type === "memory") {
		return profile.storage;
	}
	if (profile.storage.type === "indexeddb") {
		return {
			...profile.storage,
			dbName: `${profile.storage.dbName}-${peerId}`,
		};
	}
	return profile.storage;
};

const createPeer = async (
	peerId: string,
	profile: MiniCutCrdtStorageProfile,
) => {
	const ctx = await bootDktModels({
		crdt: {
			enabled: true,
			peerId,
			storage: storageForPeer(profile, peerId),
			transport: null,
		},
		unloadModels: profile.unloadModels,
	});
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: `Pair ${peerId}`,
		});
	});
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected project");
	const tracks = await ctx.queryRel(project, "tracks");
	const trackKinds = await Promise.all(
		tracks.map(async (track) => ({
			track,
			kind: await ctx.queryAttr(track, "kind"),
		})),
	);
	const videoTrack = trackKinds.find((item) => item.kind === "video")?.track;
	if (!videoTrack) throw new Error("Expected video track");
	drainCrdtOutbox(ctx.runtime);
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
	drainCrdtOutbox(ctx.runtime);
	return clip;
};

const mapOpsToNode = (ops: unknown[], nodeId: string) =>
	ops
		.filter((op) => (op as { kind?: unknown }).kind === "attr")
		.map((op) => ({ ...(op as object), node_id: nodeId }));

describe("MiniCut CRDT pair storage matrix", () => {
	for (const profile of createMiniCutCrdtStorageProfiles()) {
		it(`applies mapped timing edits with ${profile.name}`, async () => {
			const a = await createPeer("A", profile);
			const b = await createPeer("B", profile);
			const clipA = await addClip(a.ctx, a.videoTrack);
			const clipB = await addClip(b.ctx, b.videoTrack);

			await a.ctx.lockToRead(async () => {
				await clipA.dispatch("trim", { edge: "start", delta: 1 });
			});
			await b.ctx.runtime.crdt_runtime?.receiveCanonicalOps?.(
				clipB,
				mapOpsToNode(drainCrdtOutbox(a.ctx.runtime), String(clipB._node_id)),
			);
			await b.ctx.computed();

			await expect(b.ctx.queryAttr(clipB, "start")).resolves.toBe(1);
			await expect(b.ctx.queryAttr(clipB, "in")).resolves.toBe(1);
			await expect(b.ctx.queryAttr(clipB, "duration")).resolves.toBe(3);
			await a.ctx.close();
			await b.ctx.close();
		});
	}
});
