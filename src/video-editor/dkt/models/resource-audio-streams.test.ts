import { describe, expect, it } from "vitest";
import { expectProjectGraphInvariants, findTrackByKind } from "../test/projectGraphAssertions";
import { bootDktModels } from "../testingInit";

const setupProject = async () => {
	const ctx = await bootDktModels();
	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", { title: "Audio streams" });
	});
	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("No active project");
	return { ctx, project, videoTrack: await findTrackByKind(ctx, "video"), audioTrack: await findTrackByKind(ctx, "audio") };
};

const videoPayload = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	kind: "video",
	url: `http://test/${name}.webm`,
	mime: "video/webm",
	duration: 3,
	size: 1024,
	source: { kind: "local", ownerPeerId: "test-peer" },
	status: "ready",
	data: { status: "ready", chunkSize: 1024, chunks: {}, ranges: { loaded: [[0, 1024]], requested: [] }, loadedBytes: 1024 },
	...extra,
});

describe("embedded audio follows the audio streams of the imported source", () => {
	const importFirst = async (extra: Record<string, unknown>) => {
		const setup = await setupProject();
		await setup.ctx.lockToRead(async () => {
			await setup.project.dispatch("importResource", videoPayload("Clip", { addToTimelineWhenEmpty: true, ...extra }));
		});
		return setup;
	};
	const clipCounts = async ({ ctx, videoTrack, audioTrack }: Awaited<ReturnType<typeof setupProject>>) => ({
		video: (await ctx.queryRel(videoTrack, "clips")).length,
		audio: (await ctx.queryRel(audioTrack, "clips")).length,
	});

	it("adds no embedded audio clip for a video without audio streams", async () => {
		const setup = await importFirst({ audioStreams: 0 });
		expect(await clipCounts(setup)).toEqual({ video: 1, audio: 0 });
		const [resource] = await setup.ctx.queryRel(setup.project, "resources");
		expect(setup.ctx.getAttr(resource!, "audioStreams")).toBe(0);
		await expectProjectGraphInvariants(setup.ctx);
	});

	it("adds the embedded audio clip for a video with audio", async () => {
		const setup = await importFirst({ audioStreams: 1 });
		expect(await clipCounts(setup)).toEqual({ video: 1, audio: 1 });
		const [resource] = await setup.ctx.queryRel(setup.project, "resources");
		expect(setup.ctx.getAttr(resource!, "audioStreams")).toBe(1);
	});

	it("keeps adding the clip when the audio streams are unknown", async () => {
		for (const extra of [{}, { audioStreams: null }, { audioStreams: -1 }, { audioStreams: "0" }]) {
			const setup = await importFirst(extra);
			expect(await clipCounts(setup)).toEqual({ video: 1, audio: 1 });
			const [resource] = await setup.ctx.queryRel(setup.project, "resources");
			expect(setup.ctx.getAttr(resource!, "audioStreams")).toBeNull();
		}
	});

	it("does not add embedded audio manually or through addResourceToTimeline for a silent video", async () => {
		const setup = await setupProject();
		await setup.ctx.lockToRead(async () => {
			await setup.project.dispatch("importResource", videoPayload("Silent", { audioStreams: 0 }));
			await setup.project.dispatch("importResource", videoPayload("Loud", { audioStreams: 2 }));
		});
		const resources = await setup.ctx.queryRel(setup.project, "resources");
		const byName = (name: string) => resources.find((item) => setup.ctx.getAttr(item, "name") === name)!;
		await setup.ctx.lockToRead(async () => {
			await setup.project.dispatch("addEmbeddedAudioToTimeline", { resourceId: byName("Silent")._node_id });
			await setup.project.dispatch("addResourceToTimeline", byName("Silent")._node_id);
		});
		expect(await clipCounts(setup)).toEqual({ video: 1, audio: 0 });
		await setup.ctx.lockToRead(async () => {
			await setup.project.dispatch("addEmbeddedAudioToTimeline", { resourceId: byName("Loud")._node_id });
		});
		expect(await clipCounts(setup)).toEqual({ video: 1, audio: 1 });
		await expectProjectGraphInvariants(setup.ctx);
	});
});
