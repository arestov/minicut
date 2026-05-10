import { describe, expect, it } from "vitest";
import {
	expectClipTiming,
	expectProjectGraphInvariants,
} from "../test/projectGraphAssertions";
import { bootDktModels } from "../testingInit";

const setupProjectWithVideoClip = async () => {
	const ctx = await bootDktModels();

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "Append Start Test",
		});
	});

	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("No active project");

	const tracks = await ctx.queryRel(project, "tracks");
	const videoTrack = tracks.find((t) => ctx.getAttr(t, "kind") === "video");
	const audioTrack = tracks.find((t) => ctx.getAttr(t, "kind") === "audio");
	if (!videoTrack) throw new Error("No video track");
	if (!audioTrack) throw new Error("No audio track");

	return { ctx, project, videoTrack, audioTrack };
};

describe("addResourceToTimeline append start", () => {
	it("video track appendStart comp is 0 when no clips exist", async () => {
		const { ctx, videoTrack } = await setupProjectWithVideoClip();

		const appendStart = ctx.getAttr(videoTrack, "appendStart");
		expect(appendStart).toBe(0);
		await expectProjectGraphInvariants(ctx);
	});

	it("video track appendStart equals max(start+duration) after one clip", async () => {
		const { ctx, videoTrack } = await setupProjectWithVideoClip();

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addClip", {
				name: "Video 1",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 1.5,
			});
		});

		const appendStart = ctx.getAttr(videoTrack, "appendStart");
		expect(appendStart).toBe(1.5);

		const [clip] = await ctx.queryRel(videoTrack, "clips");
		expectClipTiming(ctx, clip, {
			clipId: String(clip._node_id),
			start: 0,
			duration: 1.5,
		});
		await expectProjectGraphInvariants(ctx);
	});

	it("addResourceToTimeline places new clip after existing clips via deps", async () => {
		const { ctx, project, videoTrack } = await setupProjectWithVideoClip();

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addClip", {
				name: "Baseline Video",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 1.5,
			});
		});

		await ctx.lockToRead(async () => {
			await project.dispatch("importResource", {
				name: "Image 1",
				kind: "image",
				url: "http://test/image.png",
				mime: "image/png",
				duration: 1.0,
				size: 500,
				source: { kind: "local", ownerPeerId: "test-peer" },
				status: "ready",
				data: {
					status: "ready",
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 500]], requested: [] },
					loadedBytes: 500,
				},
			});
		});

		const resources = await ctx.queryRel(project, "resources");
		const imageResource = resources.find(
			(resource) => ctx.getAttr(resource, "name") === "Image 1",
		);
		if (!imageResource?._node_id) {
			throw new Error("Expected imported image resource");
		}

		await ctx.lockToRead(async () => {
			await project.dispatch("addResourceToTimeline", imageResource._node_id);
		});

		const videoClipsFinal = await ctx.queryRel(videoTrack, "clips");
		let imageClip: (typeof videoClipsFinal)[number] | undefined;
		for (const clip of videoClipsFinal) {
			const resourceRel = await ctx.queryRel(clip, "resource");
			if (resourceRel[0]?._node_id === imageResource._node_id) {
				imageClip = clip;
				break;
			}
		}
		expect(imageClip).toBeTruthy();
		expectClipTiming(ctx, imageClip, {
			resourceId: String(imageResource._node_id),
			start: 1.5,
			duration: 1,
		});
		expect(ctx.getAttr(videoTrack, "appendStart")).toBe(2.5);
		await expectProjectGraphInvariants(ctx);
	});

	it("addResourceToTimeline places audio clip after existing audio clips", async () => {
		const { ctx, project, audioTrack } = await setupProjectWithVideoClip();

		await ctx.lockToRead(async () => {
			await audioTrack.dispatch("addClip", {
				name: "Baseline Audio",
				mediaKind: "audio",
				start: 0,
				in: 0,
				duration: 1.5,
			});
		});

		await ctx.lockToRead(async () => {
			await project.dispatch("importResource", {
				name: "Audio 1",
				kind: "audio",
				url: "http://test/audio.wav",
				mime: "audio/wav",
				duration: 1.0,
				size: 800,
				source: { kind: "local", ownerPeerId: "test-peer" },
				status: "ready",
				data: {
					status: "ready",
					chunkSize: 1024,
					chunks: {},
					ranges: { loaded: [[0, 800]], requested: [] },
					loadedBytes: 800,
				},
			});
		});

		const resources = await ctx.queryRel(project, "resources");
		const audioResource = resources.find(
			(resource) => ctx.getAttr(resource, "name") === "Audio 1",
		);
		if (!audioResource?._node_id) {
			throw new Error("Expected imported audio resource");
		}

		await ctx.lockToRead(async () => {
			await project.dispatch("addResourceToTimeline", audioResource._node_id);
		});

		const audioClips = await ctx.queryRel(audioTrack, "clips");
		const toneClip = [...audioClips].sort(
			(a, b) =>
				Number(ctx.getAttr(b, "start")) - Number(ctx.getAttr(a, "start")),
		)[0];
		expect(toneClip).toBeTruthy();
		expect(audioClips.length).toBeGreaterThanOrEqual(1);
		expectClipTiming(ctx, toneClip, {});
		await expectProjectGraphInvariants(ctx);
	});
});
