import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { bootDktModels, type DktTestContext } from "../testingInit";
import { drainCrdtOutbox } from "../test/crdtAssertions";
import type { MiniCutDktCrdtStorageOptions } from "../testingInit";

type Model = DktTestContext["sessionRoot"];

const storageProfiles: {
	name: "memory" | "indexeddb";
	storage: (peerId: string) => MiniCutDktCrdtStorageOptions;
}[] = [
	{ name: "memory", storage: () => "memory" },
	{
		name: "indexeddb",
		storage: (peerId) => ({
			type: "indexeddb",
			dbName: `minicut-pair-indexeddb-${peerId}-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}`,
			indexedDB,
		}),
	},
];

const createPeer = async (
	peerId: string,
	storage: MiniCutDktCrdtStorageOptions,
) => {
	const ctx = await bootDktModels({
		crdt: { enabled: true, peerId, storage, transport: null },
	});
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: `Pair ${peerId}`,
		});
	});
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("Expected project");
	const videoTrack = (await ctx.queryRel(project, "tracks")).find(
		(track) => ctx.getAttr(track, "kind") === "video",
	);
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
	for (const profile of storageProfiles) {
		it(`applies mapped timing edits with ${profile.name}`, async () => {
			const a = await createPeer("A", profile.storage("A"));
			const b = await createPeer("B", profile.storage("B"));
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

			expect(b.ctx.getAttr(clipB, "start")).toBe(1);
			expect(b.ctx.getAttr(clipB, "in")).toBe(1);
			expect(b.ctx.getAttr(clipB, "duration")).toBe(3);
			await a.ctx.close();
			await b.ctx.close();
		});
	}
});
