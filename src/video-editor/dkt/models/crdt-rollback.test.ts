import { describe, expect, it } from "vitest";
import { bootDktModels } from "../testingInit";
import {
	drainCrdtOutbox,
	expectCrdtMetaCount,
	expectNoCrdtStagedOps,
} from "../test/crdtAssertions";

const setupClip = async () => {
	const ctx = await bootDktModels({
		aggregateValidation: "error",
		crdt: {
			enabled: true,
			peerId: `rollback:${Math.random().toString(36).slice(2)}`,
			storage: "memory",
			transport: null,
		},
	});
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "CRDT rollback project",
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
			name: "rollback-fixture.webm",
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
	drainCrdtOutbox(ctx.runtime);
	return { ctx, clip };
};

describe("MiniCut CRDT rollback", () => {
	it("rolls back invalid timing write and records aggregate conflict without staging ops", async () => {
		const { ctx, clip } = await setupClip();

		await ctx.lockToRead(async () => {
			await clip.dispatch("setTimelineAttrs", {
				start: 0,
				in: 0,
				duration: 0,
			});
		});

		expect(ctx.getAttr(clip, "duration")).toBe(4);
		expectNoCrdtStagedOps(ctx.runtime);
		expectCrdtMetaCount(
			clip,
			"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
			1,
		);
		expect(ctx.runtime.crdt_runtime?.conflict_store?.readConflicts?.({
			aggregate: "clipTiming",
			status: "open",
		})).toEqual([
			expect.objectContaining({
				field_name: "start",
				kind: "group_invariant_violation",
			}),
		]);
	});
});
