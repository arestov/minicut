import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { createRoot } from "solid-js";
import { createPreviewProxyCache } from "../../../video-editor/media/node/preview/previewProxyCache";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { waitForAttr } from "../fixtures/scopeWait";
import { openRealHostFixture, type RealHostFixture } from "../host/realHostFixture";
import { gpuixFixture } from "../test/mediaFixtures";
import type { PreviewFrame } from "./frameSource";
import { createNodePreviewController, type NodePreviewController } from "./nodePreviewController";

// Real worker + LevelDB + ffmpeg; the plan comes from the model's own attrs.
let host: RealHostFixture | null = null;
let controller: NodePreviewController | null = null;
let disposeRoot: (() => void) | null = null;

afterEach(async () => {
	await controller?.dispose();
	disposeRoot?.();
	await host?.close();
	controller = null;
	disposeRoot = null;
	host = null;
});

const projectShape = defineShape({
	attrs: ["importProgress", "fps", "width", "height", "duration"],
});

const nextFrame = (controller: NodePreviewController): Promise<PreviewFrame> =>
	new Promise((resolve) => {
		const stop = controller.source.subscribe((frame) => {
			stop();
			resolve({ ...frame, pixels: Uint8Array.from(frame.pixels) });
			frame.release();
		});
	});

test("an empty timeline shows a black frame, an imported clip shows decoded pixels", async () => {
	host = await openRealHostFixture();
	const h = host;
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller = createNodePreviewController({
			ffmpegPath: "ffmpeg",
			assetIdFor: (id) => h.assetIndex.assetIdFor(id),
			assets: h.registry,
			probe: (filePath) => h.media.probe({ requestId: "p", source: { path: filePath } }),
		});
	});
	const preview = controller!;
	expect(preview.source).toMatchObject({ width: 480, height: 270, pixelRatio: 2 });

	const first = nextFrame(preview);
	preview.updatePlan({ projectId: "p", fps: 30, width: 1920, height: 1080, duration: 0, clipSources: [] });
	preview.source.request(0);
	const black = await first;
	expect([black.width, black.height]).toEqual([960, 540]);
	expect(black.pixels.slice(0, 4)).toEqual(Uint8Array.from([0, 0, 0, 255]));

	const importer = h.attachImport();
	const root = await h.driver.root();
	const project = await h.driver.waitOne(root, "activeProject");
	h.page.mountShape(project, projectShape);
	importer.requestImport([await gpuixFixture("video-audio")]);
	const structure = (await waitForAttr(h.page, root, "previewStructure", (value) =>
		((value as { clipSources?: unknown[] } | null)?.clipSources?.length ?? 0) > 0,
	)) as { clipSources: never[] };
	await waitForAttr(h.page, project, "duration", (value) => typeof value === "number");
	// The asset index is a synced projection: wait until it knows the resource.
	await new Promise<void>((resolve) => {
		const check = () => h.assetIndex.assetIdFor((structure.clipSources[0] as { resourceId: string }).resourceId) && resolve();
		const stop = h.assetIndex.subscribe(() => {
			if (h.assetIndex.assetIdFor((structure.clipSources[0] as { resourceId: string }).resourceId)) {
				stop();
				resolve();
			}
		});
		check();
	});

	const frame = nextFrame(preview);
	preview.updatePlan({ projectId: "p", fps: 30, width: 320, height: 240, duration: 2, clipSources: structure.clipSources });
	const decoded = await frame;
	expect([decoded.width, decoded.height]).toEqual([960, 540]);
	expect(decoded.pixels.some((value, index) => index % 4 !== 3 && value > 20)).toBe(true);
	expect(preview.notice()).toBeNull();
}, 60_000);

test("a clip whose source file cannot be resolved is reported and previews as black", async () => {
	let notice: NodePreviewController | null = null;
	createRoot((dispose) => {
		disposeRoot = dispose;
		notice = controller = createNodePreviewController({
			ffmpegPath: "ffmpeg",
			assetIdFor: () => null,
			assets: { resolve: () => ({ ok: false, error: { code: "asset-not-found", message: "x" } }) },
			probe: () => Promise.reject(new Error("unused")),
		});
	});
	const preview = notice!;
	const frame = nextFrame(preview);
	preview.updatePlan({
		projectId: "p",
		fps: 30,
		width: 320,
		height: 240,
		duration: 2,
		clipSources: [{ id: "c", resourceId: "r", resourceKind: "video", start: 0, duration: 2, inPoint: 0 } as never],
	});
	preview.source.request(0);
	const shown = await frame;
	expect(shown.pixels.slice(0, 4)).toEqual(Uint8Array.from([0, 0, 0, 255]));
	expect(preview.notice()).toBe("1 source file is missing");
});

test("with the proxy cache, preview decodes from the scrub proxy once it is ready", async () => {
	host = await openRealHostFixture();
	const h = host;
	const proxies = createPreviewProxyCache({
		dir: path.join(h.profileDir, "cache", "preview-proxies"),
		mediaService: h.media,
	});
	createRoot((dispose) => {
		disposeRoot = dispose;
		controller = createNodePreviewController({
			ffmpegPath: "ffmpeg",
			assetIdFor: (id) => h.assetIndex.assetIdFor(id),
			contentKeyFor: (id) => h.assetIndex.contentKeyFor(id),
			proxies,
			assets: h.registry,
			probe: (filePath) => h.media.probe({ requestId: "p", source: { path: filePath } }),
		});
	});
	const preview = controller!;
	const importer = h.attachImport();
	const root = await h.driver.root();
	const project = await h.driver.waitOne(root, "activeProject");
	h.page.mountShape(project, projectShape);
	const video = await gpuixFixture("video-audio");
	importer.requestImport([video]);
	const structure = (await waitForAttr(h.page, root, "previewStructure", (value) =>
		((value as { clipSources?: unknown[] } | null)?.clipSources?.length ?? 0) > 0,
	)) as { clipSources: Array<{ resourceId: string }> };
	const resourceId = structure.clipSources[0].resourceId;
	const key = await new Promise<string>((resolve) => {
		const check = () => {
			const value = h.assetIndex.contentKeyFor(resourceId);
			if (value) {
				stop();
				resolve(value);
			}
		};
		const stop = h.assetIndex.subscribe(check);
		check();
	});

	const first = nextFrame(preview);
	preview.updatePlan({ projectId: "p", fps: 25, width: 320, height: 240, duration: 2, clipSources: structure.clipSources as never });
	preview.source.request(0.5);
	await first;
	expect(preview.stats().proxyDecodes).toBe(0);

	// The proxy was requested when the source was set; wait for the same job.
	await proxies.ensure({ contentKey: key, sourcePath: video });
	const second = nextFrame(preview);
	preview.source.request(1.0);
	const frame = await second;

	expect(preview.stats().proxyDecodes).toBeGreaterThan(0);
	expect(frame.pixels.some((value, index) => index % 4 !== 3 && value > 20)).toBe(true);
	await proxies.dispose();
}, 90_000);
