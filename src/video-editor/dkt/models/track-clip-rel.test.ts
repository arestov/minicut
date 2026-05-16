import { describe, expect, it } from "vitest";
import { expectProjectGraphInvariants } from "../test/projectGraphAssertions";
import { bootDktModels } from "../testingInit";

const setupProjectAndTrack = async () => {
	const ctx = await bootDktModels();

	await ctx.lockToRead(async () => {
		await ctx.sessionRoot.dispatch("createProject", {
			title: "Track-Clip Rel Test Project",
		});
	});

	const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
	if (!project) throw new Error("No active project after createProject");

	const tracks = await ctx.queryRel(project, "tracks");
	const videoTrack = tracks.find((t) => ctx.getAttr(t, "kind") === "video");
	if (!videoTrack) throw new Error("Video track not found");

	return { ctx, project, videoTrack };
};

describe("Track self-rel: addClip", () => {
	it("addClip sets track rel on the newly created clip", async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack();

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addClip", {
				name: "Test Clip",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 2,
			});
		});

		const clips = await ctx.queryRel(videoTrack, "clips");
		expect(clips).toHaveLength(1);

		const clip = clips[0];
		const trackRel = await ctx.queryRel(clip, "track");
		expect(trackRel).toHaveLength(1);
		expect(trackRel[0]).toBe(videoTrack);
		await expectProjectGraphInvariants(ctx);
	});

	it("addClip with multiple clips keeps track rel for every clip", async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack();

		for (let i = 0; i < 3; i += 1) {
			await ctx.lockToRead(async () => {
				await videoTrack.dispatch("addClip", {
					name: `Clip ${i}`,
					mediaKind: "video",
					start: i,
					in: 0,
					duration: 1,
				});
			});
		}

		const clips = await ctx.queryRel(videoTrack, "clips");
		expect(clips).toHaveLength(3);

		for (const clip of clips) {
			const trackRel = await ctx.queryRel(clip, "track");
			expect(trackRel).toHaveLength(1);
			expect(trackRel[0]).toBe(videoTrack);
		}
		await expectProjectGraphInvariants(ctx);
	});
});

describe("Track self-rel: addTextClip", () => {
	it("addTextClip sets track rel on the created text clip", async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack();

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addTextClip", {
				name: "Text Clip",
				mediaKind: "text",
				start: 0,
				in: 0,
				duration: 3,
				text: {
					content: "Hello World",
					style: {
						fontFamily: "Inter",
						fontSize: 48,
						color: "#ffffff",
					},
					box: {
						x: 0.1,
						y: 0.1,
						width: 0.5,
						height: 0.2,
					},
				},
			});
		});

		const clips = await ctx.queryRel(videoTrack, "clips");
		expect(clips).toHaveLength(1);

		const clip = clips[0];
		expect(ctx.getAttr(clip, "mediaKind")).toBe("text");

		const trackRel = await ctx.queryRel(clip, "track");
		expect(trackRel).toHaveLength(1);
		expect(trackRel[0]).toBe(videoTrack);

		const textRel = await ctx.queryRel(clip, "text");
		expect(textRel).toHaveLength(1);
		const textNode = textRel[0];
		expect(ctx.getAttr(textNode, "content")).toBe("Hello World");

		const textClipRel = await ctx.queryRel(textNode, "clip");
		expect(textClipRel).toHaveLength(1);
		expect(textClipRel[0]).toBe(clip);
		await expectProjectGraphInvariants(ctx);
	});
});

describe("Track self-rel: splitClipAt", () => {
	it("splitClipAt sets track rel on the right-split clip", async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack();

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addClip", {
				name: "Base Clip",
				mediaKind: "video",
				start: 0,
				in: 0,
				duration: 2,
			});
		});

		const before = await ctx.queryRel(videoTrack, "clips");
		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("splitClipAt", {
				name: "Base Clip",
				mediaKind: "video",
				splitTime: 1,
				sourceClip: { start: 0, in: 0, duration: 2 },
				start: 1,
				in: 1,
				duration: 1,
			});
		});

		const clips = await ctx.queryRel(videoTrack, "clips");
		const rightClip = clips.find(
			(c) => !before.some((prev) => prev._node_id === c._node_id),
		);
		expect(rightClip).toBeTruthy();

		if (!rightClip) {
			throw new Error("Right clip not found");
		}
		const trackRel = await ctx.queryRel(rightClip, "track");
		expect(trackRel).toHaveLength(1);
		expect(trackRel[0]).toBe(videoTrack);
		await expectProjectGraphInvariants(ctx);
	});

	it("splitClipAt clones text ownership onto the right split clip", async () => {
		const { ctx, videoTrack } = await setupProjectAndTrack();

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("addTextClip", {
				name: "Split Text Clip",
				mediaKind: "text",
				start: 2,
				in: 0,
				duration: 4,
				text: {
					content: "Split me",
					style: {
						fontFamily: "Inter",
						fontSize: 32,
						color: "#ffffff",
					},
					box: {
						x: 0.2,
						y: 0.2,
						width: 0.4,
						height: 0.2,
					},
				},
			});
		});

		const beforeClips = await ctx.queryRel(videoTrack, "clips");
		const sourceClip = beforeClips.find(
			(clip) => ctx.getAttr(clip, "name") === "Split Text Clip",
		);
		if (!sourceClip) {
			throw new Error("Expected source text clip");
		}
		const sourceText = (await ctx.queryRel(sourceClip, "text"))[0];
		if (!sourceText) {
			throw new Error("Expected source text");
		}

		await ctx.lockToRead(async () => {
			await videoTrack.dispatch("splitClipAt", {
				name: "Split Text Clip",
				mediaKind: "text",
				splitTime: 4,
				sourceClip: { start: 2, in: 0, duration: 4 },
				text: sourceText,
			});
		});

		const clips = await ctx.queryRel(videoTrack, "clips");
		const rightClip = clips.find(
			(clip) =>
				!beforeClips.some((before) => before._node_id === clip._node_id),
		);
		if (!rightClip) {
			throw new Error("Expected right split clip");
		}

		const rightTrackRel = await ctx.queryRel(rightClip, "track");
		expect(rightTrackRel).toEqual([videoTrack]);
		const rightTextRel = await ctx.queryRel(rightClip, "text");
		expect(rightTextRel).toHaveLength(1);
		expect(rightTextRel[0]?._node_id).not.toBe(sourceText._node_id);
		expect(ctx.getAttr(rightTextRel[0], "content")).toBe("Split me");
		expect(await ctx.queryRel(rightTextRel[0], "clip")).toEqual([rightClip]);
		await expectProjectGraphInvariants(ctx);
	});
});
