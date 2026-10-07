import { expect, test } from "bun:test";
import type { AssetResolver } from "../../../video-editor/media/contracts/assets";
import type { ProbeResult } from "../../../video-editor/media/contracts/probe";
import type { PreviewClipSource } from "../../../video-editor/read-model/previewComps";
import type { PreviewPlanInput } from "../preview/nodePreviewController";
import { createAudioMixController } from "./audioMixController";

const source = (id: string, kind: string, extra: Record<string, unknown> = {}): PreviewClipSource =>
	({
		id,
		resourceId: `res-${id}`,
		resourceKind: kind,
		resourceSource: { sourceKind: "local-asset", sourceRef: `asset-${id}` },
		start: 0,
		duration: 2,
		inPoint: 0,
		audio: { gain: 1, pan: 0 },
		...extra,
	}) as unknown as PreviewClipSource;

const plan = (clipSources: PreviewClipSource[]): PreviewPlanInput => ({
	projectId: "p",
	fps: 30,
	width: 640,
	height: 360,
	duration: 4,
	clipSources,
});

const setup = (channelsByPath: Record<string, number | null> = {}, missing: string[] = []) => {
	const probed: string[] = [];
	const assets: AssetResolver = {
		resolve: (assetId) =>
			missing.includes(assetId)
				? { ok: false, error: { code: "asset-not-found", message: "gone" } }
				: { ok: true, location: { path: `C:/media/${assetId}.wav` } },
	};
	const controller = createAudioMixController({
		assets,
		probe: async (filePath) => {
			probed.push(filePath);
			const channels = channelsByPath[filePath] === undefined ? 2 : channelsByPath[filePath];
			return { audio: channels === null ? null : { channels } } as unknown as ProbeResult;
		},
	});
	const changes: number[] = [];
	controller.subscribe(() => changes.push(changes.length + 1));
	return { controller, probed, changes };
};

test("describes the audio clips with files and channel counts and ignores video clips", async () => {
	const { controller, changes } = setup({ "C:/media/asset-m.wav": 1 });
	controller.updatePlan(plan([source("v", "video"), source("a", "audio"), source("m", "audio")]));
	await controller.idle();

	const mix = controller.current();
	expect(mix?.assets).toEqual({
		"res-a": { path: "C:/media/asset-a.wav" },
		"res-m": { path: "C:/media/asset-m.wav" },
	});
	expect(mix?.audioChannels).toEqual({ "res-a": 2, "res-m": 1 });
	expect(mix?.plan.clipSources.map((clip) => clip.id)).toEqual(["a", "m"]);
	expect(changes).toEqual([1]);
});

test("leaves out missing files and silent resources; no playable audio means no mix", async () => {
	const { controller } = setup({ "C:/media/asset-s.wav": null }, ["asset-gone"]);
	controller.updatePlan(plan([source("gone", "audio"), source("s", "audio"), source("a", "audio")]));
	await controller.idle();

	expect(controller.current()?.silentAudioResources).toEqual(["res-s"]);
	expect(Object.keys(controller.current()?.assets ?? {}).sort()).toEqual(["res-a", "res-s"]);

	controller.updatePlan(plan([source("gone", "audio")]));
	await controller.idle();
});

test("notifies only when the audio mix changes, not for video edits or an identical plan", async () => {
	const { controller, changes } = setup();
	controller.updatePlan(plan([source("a", "audio"), source("v", "video")]));
	await controller.idle();

	controller.updatePlan(plan([source("a", "audio"), source("v", "video", { start: 1 })]));
	controller.updatePlan(plan([source("a", "audio"), source("v", "video", { start: 1 })]));
	controller.updatePlan(plan([source("a", "audio", { start: 1 })]));
	await controller.idle();

	expect(changes).toEqual([1, 2]);
});

test("a null plan clears the mix", async () => {
	const { controller, changes } = setup();
	controller.updatePlan(plan([source("a", "audio")]));
	await controller.idle();
	controller.updatePlan(null);
	await controller.idle();
	expect(changes).toEqual([1, 2]);
});
