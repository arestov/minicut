import { describe, expect, it } from "vitest";
import { bootDktModels } from "../testingInit";

const emptyDrafts = () => Object.create(null) as Record<string, unknown>;

const createAttrPatch = (nodeId: string, values: Record<string, unknown>) => ({
	attrs_by_node: {
		[nodeId]: { values },
	},
	rels_by_node: emptyDrafts(),
	mentions_by_node: emptyDrafts(),
});

const createRelPatch = (nodeId: string, values: Record<string, unknown>) => ({
	attrs_by_node: emptyDrafts(),
	rels_by_node: {
		[nodeId]: { values },
	},
	mentions_by_node: emptyDrafts(),
});

const setupProjectWithVideoTrack = async () => {
	const ctx = await bootDktModels();
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "Semantic Baseline",
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
	return { ctx, project, videoTrack };
};

describe("semantic graph baseline", () => {
	it("rejects direct track membership patch when inverse side is stale", async () => {
		const ctx = await bootDktModels({
			graphSemantics: { inverseValidation: "error" },
		});
		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("createProject", {
				title: "Inverse Strict",
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
		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addClip", {
				name: "Inverse Clip",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 3,
			});
		});
		const clips = await ctx.queryRel(videoTrack, "clips");
		expect(clips).toHaveLength(1);
		const runtime = ctx.runtime;
		if (typeof runtime.applyExternalGraphPatch !== "function") {
			throw new Error("Runtime applyExternalGraphPatch is unavailable");
		}
		await expect(
			Promise.resolve(
				runtime.applyExternalGraphPatch(
					createRelPatch(String(videoTrack._node_id), { clips: [] }),
					{ origin: "sync_receiver", intent_type: "external_patch" },
				),
			),
		).rejects.toThrow("REL_INVERSE_MISMATCH");
		expect(await ctx.queryRel(videoTrack, "clips")).toHaveLength(1);
	});

	it("rejects clip timing patch with non-positive duration", async () => {
		const { ctx, videoTrack } = await setupProjectWithVideoTrack();
		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addClip", {
				name: "Timing Clip",
				mediaKind: "video",
				start: 2,
				in: 1,
				duration: 4,
			});
		});
		const clip = (await ctx.queryRel(videoTrack, "clips"))[0];
		if (!clip) {
			throw new Error("Expected clip");
		}
		const runtime = ctx.runtime;
		if (typeof runtime.applyExternalGraphPatch !== "function") {
			throw new Error("Runtime applyExternalGraphPatch is unavailable");
		}
		expect(ctx.getAttr(clip, "duration")).toBe(4);
		await expect(
			Promise.resolve(
				runtime.applyExternalGraphPatch(
					createAttrPatch(String(clip._node_id), { duration: 0 }),
					{ origin: "sync_receiver", intent_type: "external_patch" },
				),
			),
		).rejects.toThrow('aggregate "clipTiming" validation failed');
		expect(ctx.getAttr(clip, "duration")).toBe(4);
		expect(ctx.getAttr(clip, "start")).toBe(2);
		expect(ctx.getAttr(clip, "in")).toBe(1);
	});

	it("rejects clip timing patch with negative start", async () => {
		const { ctx, videoTrack } = await setupProjectWithVideoTrack();
		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addClip", {
				name: "Negative Start Clip",
				mediaKind: "video",
				start: 1,
				in: 1,
				duration: 3,
			});
		});
		const clip = (await ctx.queryRel(videoTrack, "clips"))[0];
		if (!clip) {
			throw new Error("Expected clip");
		}
		const runtime = ctx.runtime;
		if (typeof runtime.applyExternalGraphPatch !== "function") {
			throw new Error("Runtime applyExternalGraphPatch is unavailable");
		}
		await expect(
			Promise.resolve(
				runtime.applyExternalGraphPatch(
					createAttrPatch(String(clip._node_id), { start: -1 }),
					{ origin: "sync_receiver", intent_type: "external_patch" },
				),
			),
		).rejects.toThrow('aggregate "clipTiming" validation failed');
		expect(ctx.getAttr(clip, "start")).toBe(1);
		expect(ctx.getAttr(clip, "duration")).toBe(3);
	});

	it("rejects external writes to session projection aggregate", async () => {
		const ctx = await bootDktModels();
		const runtime = ctx.runtime;
		if (typeof runtime.applyExternalGraphPatch !== "function") {
			throw new Error("Runtime applyExternalGraphPatch is unavailable");
		}
		await expect(
			Promise.resolve(
				runtime.applyExternalGraphPatch(
					{
						attrs_by_node: {
							[String(ctx.sessionRoot._node_id)]: {
								values: { selectedEntityId: "clip-remote" },
							},
						},
						rels_by_node: emptyDrafts(),
						mentions_by_node: emptyDrafts(),
					},
					{ origin: "sync_receiver", intent_type: "external_patch" },
				),
			),
		).rejects.toThrow('external graph patch cannot write aggregate "sessionProjection"');
		expect(ctx.getAttr(ctx.sessionRoot, "selectedEntityId")).toBeNull();
	});
});
