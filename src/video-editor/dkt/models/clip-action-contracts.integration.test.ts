import { describe, expect, it } from "vitest";
import { expectProjectGraphInvariants } from "../test/projectGraphAssertions";
import {
	createActionContractHarness,
	dispatchAndSettle,
	readNodeIds,
} from "./action-contract-test-harness";

const createTempClip = async () => {
	const harness = await createActionContractHarness();

	await dispatchAndSettle(harness.ctx, harness.videoTrack, "addClip", {
		resource: harness.videoResource,
		name: "Integration Temp",
		mediaKind: "video",
		start: 3,
		in: 0,
		duration: 4,
	});

	const clip = (await harness.ctx.queryRel(harness.videoTrack, "clips")).find(
		(entry) => harness.ctx.getAttr(entry, "name") === "Integration Temp",
	);
	if (!clip) {
		throw new Error("Expected integration temp clip");
	}

	return { harness, clip };
};

describe("Clip action contracts", () => {
	it("rename, color, updateOpacity, and setMediaKind update clip attrs", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(
			harness.ctx,
			harness.videoClip,
			"rename",
			"Renamed Video Clip",
		);
		await dispatchAndSettle(harness.ctx, harness.videoClip, "color", "#ff00ff");
		await dispatchAndSettle(harness.ctx, harness.videoClip, "updateOpacity", {
			opacityPercent: 75,
		});
		await dispatchAndSettle(
			harness.ctx,
			harness.videoClip,
			"setMediaKind",
			"image",
		);

		expect(harness.ctx.getAttr(harness.videoClip, "name")).toBe(
			"Renamed Video Clip",
		);
		expect(harness.ctx.getAttr(harness.videoClip, "color")).toBe("#ff00ff");
		expect(harness.ctx.getAttr(harness.videoClip, "opacity")).toEqual({
			value: 0.8,
		});
		expect(harness.ctx.getAttr(harness.videoClip, "mediaKind")).toBe("image");
	});

	it("setClipAttrs, setFade, setAudio, setTimelineAttrs, and setTransform patch the clip state", async () => {
		const harness = await createActionContractHarness();

		await dispatchAndSettle(harness.ctx, harness.videoClip, "setClipAttrs", {
			name: "Baseline Clip",
			color: "#334155",
			mediaKind: "video",
			start: 2,
			in: 1,
			duration: 5,
			fadeIn: 0.1,
			fadeOut: 0.2,
			audio: { gain: 1, pan: 0 },
			opacity: { value: 0.6 },
			transform: {
				x: { value: 1 },
				y: { value: 2 },
				scale: { value: 1 },
				rotation: { value: 0 },
			},
		});
		await dispatchAndSettle(harness.ctx, harness.videoClip, "setFade", {
			edge: "in",
			delta: 0.4,
		});
		await dispatchAndSettle(harness.ctx, harness.videoClip, "setAudio", {
			gain: 0.8,
			pan: -0.25,
		});
		await dispatchAndSettle(
			harness.ctx,
			harness.videoClip,
			"setTimelineAttrs",
			{
				start: 4,
				in: 2,
				duration: 6,
				fadeIn: 0.3,
				fadeOut: 0.5,
			},
		);
		await dispatchAndSettle(harness.ctx, harness.videoClip, "setTransform", {
			x: 12,
			y: 24,
			scale: 1.25,
			rotation: 18,
		});

		expect(harness.ctx.getAttr(harness.videoClip, "name")).toBe(
			"Baseline Clip",
		);
		expect(harness.ctx.getAttr(harness.videoClip, "color")).toBe("#334155");
		expect(harness.ctx.getAttr(harness.videoClip, "mediaKind")).toBe("video");
		expect(harness.ctx.getAttr(harness.videoClip, "start")).toBe(4);
		expect(harness.ctx.getAttr(harness.videoClip, "in")).toBe(2);
		expect(harness.ctx.getAttr(harness.videoClip, "duration")).toBe(6);
		expect(harness.ctx.getAttr(harness.videoClip, "fadeIn")).toBe(0.3);
		expect(harness.ctx.getAttr(harness.videoClip, "fadeOut")).toBe(0.5);
		expect(harness.ctx.getAttr(harness.videoClip, "audio")).toEqual({
			gain: 0.8,
			pan: -0.25,
		});
		expect(harness.ctx.getAttr(harness.videoClip, "opacity")).toEqual({
			value: 0.6,
		});
		expect(harness.ctx.getAttr(harness.videoClip, "transform")).toEqual({
			x: { value: 12 },
			y: { value: 24 },
			scale: { value: 1.25 },
			rotation: { value: 18 },
		});
	});

	it("setResource, setText, setTrack, setProject, addEffect, removeEffect, reorderEffect, and setEffects mutate relations", async () => {
		const { harness, clip } = await createTempClip();

		await dispatchAndSettle(
			harness.ctx,
			harness.ctx.appModel,
			"createTextModel",
			{
				content: "Integration temp text",
				style: {
					fontFamily: "Inter",
					fontSize: 36,
					color: "#ffffff",
				},
				box: {
					x: 0.1,
					y: 0.1,
					width: 0.5,
					height: 0.2,
				},
			},
		);

		const text = (
			await harness.ctx.queryRel(harness.ctx.appModel, "text")
		).find(
			(entry) =>
				harness.ctx.getAttr(entry, "content") === "Integration temp text",
		);
		if (!text) {
			throw new Error("Expected integration temp text");
		}

		await dispatchAndSettle(harness.ctx, clip, "setResource", {
			resource: harness.imageResource,
		});
		await dispatchAndSettle(harness.ctx, clip, "setText", { text });
		await dispatchAndSettle(harness.ctx, clip, "setTrack", {
			track: harness.audioTrack,
		});
		await dispatchAndSettle(harness.ctx, clip, "setProject", {
			project: harness.project,
		});
		await dispatchAndSettle(harness.ctx, clip, "addEffect", {
			kind: "blur",
			name: "Blur A",
			enabled: true,
			amount: 0.25,
		});
		await dispatchAndSettle(harness.ctx, clip, "addEffect", {
			kind: "tint",
			name: "Tint B",
			enabled: true,
			amount: 0.75,
		});

		const effects = await harness.ctx.queryRel(clip, "effects");
		expect(effects).toHaveLength(2);
		expect(harness.ctx.getAttr(effects[0], "name")).toBe("Blur A");
		expect(harness.ctx.getAttr(effects[1], "name")).toBe("Tint B");
		const firstEffectClip = await harness.ctx.queryRel(effects[0], "clip");
		expect(firstEffectClip).toHaveLength(1);
		expect(firstEffectClip[0]?._node_id).toBe(clip._node_id);

		await dispatchAndSettle(harness.ctx, clip, "reorderEffect", {
			effectId: effects[0]._node_id,
			toIndex: 1,
		});
		const reorderedEffects = await harness.ctx.queryRel(clip, "effects");
		expect(
			reorderedEffects.map((effect) => harness.ctx.getAttr(effect, "name")),
		).toEqual(["Tint B", "Blur A"]);

		await dispatchAndSettle(harness.ctx, clip, "removeEffect", {
			effectId: effects[0]._node_id,
		});
		await dispatchAndSettle(harness.ctx, clip, "setEffects", {
			effects: [effects[1]],
		});

		const nextEffects = await harness.ctx.queryRel(clip, "effects");
		expect(nextEffects).toHaveLength(1);
		expect(harness.ctx.getAttr(nextEffects[0], "name")).toBe("Tint B");
		const resourceRel = await harness.ctx.queryRel(clip, "resource");
		expect(resourceRel).toHaveLength(1);
		expect(resourceRel[0]?._node_id).toBe(harness.imageResource._node_id);

		const textRel = await harness.ctx.queryRel(clip, "text");
		expect(textRel).toHaveLength(1);
		expect(textRel[0]?._node_id).toBe(text._node_id);

		const trackRel = await harness.ctx.queryRel(clip, "track");
		expect(trackRel).toHaveLength(1);
		expect(trackRel[0]?._node_id).toBe(harness.audioTrack._node_id);

		const projectRel = await harness.ctx.queryRel(clip, "project");
		expect(projectRel).toHaveLength(1);
		expect(projectRel[0]?._node_id).toBe(harness.project._node_id);
	});

	it("removeEffect and reorderEffect are no-ops for missing effect ids", async () => {
		const { harness, clip } = await createTempClip();

		await dispatchAndSettle(harness.ctx, clip, "addEffect", {
			kind: "blur",
			name: "Stable Effect",
			enabled: true,
			amount: 0.25,
		});
		const beforeEffects = await harness.ctx.queryRel(clip, "effects");
		const beforeEffectIds = beforeEffects.map((effect) => effect._node_id);

		await dispatchAndSettle(harness.ctx, clip, "reorderEffect", {
			effectId: "effect-node:missing",
			toIndex: 0,
		});
		await dispatchAndSettle(harness.ctx, clip, "removeEffect", {
			effectId: "effect-node:missing",
		});

		const afterEffects = await harness.ctx.queryRel(clip, "effects");
		expect(afterEffects.map((effect) => effect._node_id)).toEqual(
			beforeEffectIds,
		);
		await expectProjectGraphInvariants(harness.ctx);
	});

	it("removeSelf removes the clip from its parent track", async () => {
		const { harness, clip } = await createTempClip();

		await dispatchAndSettle(harness.ctx, clip, "removeSelf");

		const clipIds = await readNodeIds(harness.ctx, harness.videoTrack, "clips");
		expect(clipIds).not.toContain(String(clip._node_id));
		await expectProjectGraphInvariants(harness.ctx);
	});
});
