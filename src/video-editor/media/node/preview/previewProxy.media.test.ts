import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PreviewClipSource } from "../../../read-model/previewComps";
import type { ExportPlan } from "../../../render/renderPlan";
import type { FileArtifact, JobOutcome } from "../../contracts/job";
import { createMediaService, type MediaService } from "../mediaService";
import { runCaptured } from "../processRunner";
import { ensureFixtures, type FixtureName } from "../testing/mediaFixtures";
import { createPreviewProducer, type PreviewSource } from "./previewProducer";
import { createPreviewProxyCache } from "./previewProxyCache";
import type { ProducedPreviewFrame } from "./previewTypes";

const FFMPEG = process.env.MINICUT_FFMPEG_PATH ?? "ffmpeg";
const FPS = 25;
// Fixture and export are 320x240; proxy and preview are 160x120.
const PLAN_W = 320;
const PLAN_H = 240;
const W = 160;
const H = 120;
/**
 * Preview-from-proxy vs export frame, compared at proxy resolution (export
 * frame scaled to 160x120). The proxy adds one lossy H.264 generation
 * (CRF 23) and a downscale before the plan instead of after it. Measured on
 * these fixtures (FFmpeg 7.1.1): video frames 0.985-0.986 from the proxy vs
 * 0.994-0.995 from the original; frames dominated by the image 0.976-0.978
 * either way (the image is never proxied; the loss is the export encode).
 */
const PROXY_SSIM_MIN = 0.95;
/** A one-frame error must score clearly lower than the matching frame. */
const NEIGHBOUR_MARGIN = 0.04;

const clip = (partial: Record<string, unknown>): PreviewClipSource =>
	({ name: "Clip", ...partial }) as unknown as PreviewClipSource;

const plan: ExportPlan = {
	projectId: "proxy-scrub",
	fps: FPS,
	width: PLAN_W,
	height: PLAN_H,
	duration: 2,
	clipSources: [
		clip({
			id: "trimmed",
			resourceId: "res-video",
			resourceKind: "video",
			start: 0.2,
			duration: 1.4,
			inPoint: 0.4, // frame-aligned
		}),
		clip({
			id: "card",
			resourceId: "res-image",
			resourceKind: "image",
			start: 1.4,
			duration: 0.6,
			inPoint: 0,
		}),
	],
};

describe("preview producer with scrub proxies", () => {
	let fixtures: Record<FixtureName, string>;
	let dir: string;
	let exported: string;
	let source: PreviewSource;

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr", "image-card"]);
		dir = await mkdtemp(path.join(os.tmpdir(), "minicut-preview-proxy-"));
		exported = path.join(dir, "export.webm");
		const outcome = await createMediaService().exportPlan({
			requestId: "proxy-export",
			plan,
			range: { type: "project" },
			outputPath: exported,
			assets: {
				"res-video": { path: fixtures["video-cfr"] },
				"res-image": { path: fixtures["image-card"] },
			},
		}).outcome;
		expect(outcome.status, JSON.stringify(outcome)).toBe("done");
		source = {
			revision: "proxy-scrub",
			plan,
			assetPaths: {
				"res-video": fixtures["video-cfr"],
				"res-image": fixtures["image-card"],
			},
			contentKeys: { "res-video": "test/video-cfr" },
		};
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const frameAt = (
		producer: ReturnType<typeof createPreviewProducer>,
		time: number,
		generation: number,
	): Promise<ProducedPreviewFrame> =>
		new Promise((resolve) => {
			producer.onFrame(resolve);
			producer.request(time, generation);
		});

	const ssimAgainstExport = async (
		frame: ProducedPreviewFrame,
		exportIndex: number,
		name: string,
	): Promise<number> => {
		const rawPath = path.join(dir, `${name}.rgba`);
		await writeFile(rawPath, frame.pixels);
		const result = await runCaptured(
			FFMPEG,
			[
				"-hide_banner", "-nostdin", "-v", "info",
				"-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-i", rawPath,
				"-i", exported,
				"-filter_complex",
				`[0:v]format=yuv420p[p];[1:v]select='eq(n,${exportIndex})',scale=${W}:${H},format=yuv420p[e];[e][p]ssim`,
				"-frames:v", "1", "-f", "null", "-",
			],
			{ timeoutMs: 60_000 },
		);
		expect(result.exitCode).toBe(0);
		const match = /SSIM[^\n]*All:([\d.]+)/.exec(result.stderr);
		expect(match, result.stderr.slice(-400)).not.toBeNull();
		return Number(match?.[1]);
	};

	it("decodes from the original until the proxy is ready, then from the proxy", async () => {
		const proxies = createPreviewProxyCache({
			dir: path.join(dir, "switch"),
			mediaService: createMediaService(),
			params: { height: H, allIntra: true },
		});
		const producer = createPreviewProducer({
			ffmpegPath: FFMPEG,
			width: W,
			height: H,
			proxies,
		});
		producer.setSource(source);
		const before = await frameAt(producer, 0.8, 1);
		before.release();
		expect(producer.stats()).toMatchObject({ decodes: 1, proxyDecodes: 0 });

		await proxies.ensure({
			contentKey: "test/video-cfr",
			sourcePath: fixtures["video-cfr"],
		});
		// The same slot is decoded again: frames from the original are cached
		// under a different key than frames from the proxy.
		const after = await frameAt(producer, 0.8, 2);
		after.release();
		expect(producer.stats()).toMatchObject({
			decodes: 2,
			proxyDecodes: 1,
			cacheHits: 0,
			proxyFailures: 0,
		});
		await producer.dispose();
		await proxies.dispose();
	});

	it("matches the export frame at proxy resolution (SSIM) and stays frame-exact", async () => {
		const proxies = createPreviewProxyCache({
			dir: path.join(dir, "ssim"),
			mediaService: createMediaService(),
			params: { height: H, allIntra: true },
		});
		await proxies.ensure({
			contentKey: "test/video-cfr",
			sourcePath: fixtures["video-cfr"],
		});
		const producer = createPreviewProducer({
			ffmpegPath: FFMPEG,
			width: W,
			height: H,
			proxies,
		});
		producer.setSource(source);
		// black, trimmed video (source 0.4..1.6 s), video + image on top
		const times = [0.1, 0.3, 0.8, 1.2, 1.56, 1.8];
		const moving = [0.3, 0.8, 1.2]; // from 1.4 s the image hides most of the video
		let generation = 0;
		for (const time of times) {
			generation += 1;
			const frame = await frameAt(producer, time, generation);
			const index = Math.floor(time * FPS + 1e-6);
			const same = await ssimAgainstExport(frame, index, `ssim-${generation}`);
			expect(same, `t=${time}`).toBeGreaterThanOrEqual(PROXY_SSIM_MIN);
			if (moving.includes(time)) {
				const other = await ssimAgainstExport(frame, index + 1, `ssim-${generation}`);
				expect(other, `control t=${time}`).toBeLessThan(same - NEIGHBOUR_MARGIN);
			}
			frame.release();
		}
		expect(producer.stats().proxyDecodes).toBe(times.length);
		await producer.dispose();
		await proxies.dispose();
	});

	it("retries a failed proxy generation once per source revision", async () => {
		const real = createMediaService();
		let calls = 0;
		const flaky: Pick<MediaService, "generateProxy"> = {
			generateProxy: (request) => {
				calls += 1;
				if (calls > 1) return real.generateProxy(request);
				const outcome: Promise<JobOutcome<FileArtifact>> = Promise.resolve({
					status: "error",
					error: { code: "process-failed", message: "transient" },
				});
				return {
					requestId: request.requestId,
					onProgress: () => () => undefined,
					onDone: () => () => undefined,
					onError: () => () => undefined,
					onCancelled: () => () => undefined,
					cancel: () => undefined,
					outcome,
				};
			},
		};
		const proxies = createPreviewProxyCache({
			dir: path.join(dir, "flaky"),
			mediaService: flaky,
			params: { height: H, allIntra: true },
		});
		const producer = createPreviewProducer({
			ffmpegPath: FFMPEG,
			width: W,
			height: H,
			proxies,
		});
		producer.setSource(source);
		await vi.waitFor(() => expect(producer.stats().proxyFailures).toBe(1));
		// Same revision: no second attempt.
		producer.setSource({ ...source });
		expect(calls).toBe(1);
		// New revision: retried, and the proxy ends up used.
		producer.setSource({ ...source, revision: "proxy-scrub-2" });
		await vi.waitFor(() =>
			expect(proxies.ready("test/video-cfr")).not.toBeNull(),
		);
		expect(calls).toBe(2);
		const frame = await frameAt(producer, 0.8, 1);
		frame.release();
		expect(producer.stats()).toMatchObject({ proxyDecodes: 1, proxyFailures: 0 });
		await producer.dispose();
		await proxies.dispose();
	});

	it("falls back to the original when proxy generation fails", async () => {
		const failing: Pick<MediaService, "generateProxy"> = {
			generateProxy: (request) => {
				const outcome: Promise<JobOutcome<FileArtifact>> = Promise.resolve({
					status: "error",
					error: { code: "process-failed", message: "encoder crashed" },
				});
				return {
					requestId: request.requestId,
					onProgress: () => () => undefined,
					onDone: () => () => undefined,
					onError: () => () => undefined,
					onCancelled: () => () => undefined,
					cancel: () => undefined,
					outcome,
				};
			},
		};
		const proxies = createPreviewProxyCache({
			dir: path.join(dir, "failing"),
			mediaService: failing,
			params: { height: H, allIntra: true },
		});
		const producer = createPreviewProducer({
			ffmpegPath: FFMPEG,
			width: W,
			height: H,
			proxies,
		});
		producer.setSource(source);
		await expect(
			proxies.ensure({ contentKey: "test/video-cfr", sourcePath: fixtures["video-cfr"] }),
		).rejects.toMatchObject({ code: "process-failed" });
		const frame = await frameAt(producer, 0.8, 1);
		const same = await ssimAgainstExport(frame, 20, "fallback");
		frame.release();
		expect(same).toBeGreaterThanOrEqual(PROXY_SSIM_MIN);
		expect(producer.stats()).toMatchObject({
			proxyFailures: 1,
			proxyDecodes: 0,
			failed: 0,
		});
		await producer.dispose();
	});

	it("ignores a proxy cache whose proxies are smaller than the preview", async () => {
		const proxies = createPreviewProxyCache({
			dir: path.join(dir, "small"),
			mediaService: createMediaService(),
			params: { height: H / 2, allIntra: true },
		});
		const producer = createPreviewProducer({
			ffmpegPath: FFMPEG,
			width: W,
			height: H,
			proxies,
		});
		producer.setSource(source);
		const frame = await frameAt(producer, 0.8, 1);
		frame.release();
		expect(producer.stats()).toMatchObject({ proxyDecodes: 0, proxyFailures: 0 });
		expect(proxies.ready("test/video-cfr")).toBeNull();
		await producer.dispose();
		await proxies.dispose();
	});
});
