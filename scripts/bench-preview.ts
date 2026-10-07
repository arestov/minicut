/**
 * Preview producer benchmark (not part of any test set).
 *
 *   node --expose-gc --import tsx ./scripts/bench-preview.ts [--out docs/preview-benchmark.md]
 *
 * Needs ffmpeg/ffprobe (MINICUT_FFMPEG_PATH overrides PATH). Generates a
 * 1920x1080 H.264 source once under tmp/media-fixtures/bench.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createMediaService } from "../src/video-editor/media/node/mediaService";
import { runCaptured } from "../src/video-editor/media/node/processRunner";
import { createFramePool } from "../src/video-editor/media/node/preview/framePool";
import { startPreviewDecode } from "../src/video-editor/media/node/preview/previewDecoder";
import {
	createPreviewProducer,
	type PreviewSource,
} from "../src/video-editor/media/node/preview/previewProducer";
import {
	createPreviewProxyCache,
	DEFAULT_PREVIEW_PROXY_PARAMS,
	type PreviewProxyCache,
} from "../src/video-editor/media/node/preview/previewProxyCache";
import type { PreviewClipSource } from "../src/video-editor/read-model/previewComps";
import type { ExportPlan } from "../src/video-editor/render/renderPlan";

const FFMPEG = process.env.MINICUT_FFMPEG_PATH ?? "ffmpeg";
const W = 960;
const H = 540;
const FPS = 25;
const SOURCE_SECONDS = 30;
const SEEKS = 40;
const STREAM_FRAMES = 150;
const SCRUB_REQUESTS = 60;
const SCRUB_INTERVAL_MS = 8;

const sourcePath = path.resolve("tmp", "media-fixtures", "bench", "bench-1080p.mp4");

const exists = async (file: string): Promise<boolean> => {
	try {
		return (await stat(file)).size > 0;
	} catch {
		return false;
	}
};

const ensureSource = async (): Promise<void> => {
	if (await exists(sourcePath)) return;
	await mkdir(path.dirname(sourcePath), { recursive: true });
	const result = await runCaptured(
		FFMPEG,
		[
			"-hide_banner", "-loglevel", "error", "-y",
			"-f", "lavfi", "-i", `testsrc2=size=1920x1080:rate=${FPS}:duration=${SOURCE_SECONDS}`,
			"-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
			sourcePath,
		],
		{ timeoutMs: 300_000 },
	);
	if (result.exitCode !== 0) throw new Error(`fixture failed: ${result.stderr}`);
};

const clip = (partial: Record<string, unknown>): PreviewClipSource =>
	({ name: "Clip", inPoint: 0, ...partial }) as unknown as PreviewClipSource;

const plan: ExportPlan = {
	projectId: "bench",
	fps: FPS,
	width: 1920,
	height: 1080,
	duration: SOURCE_SECONDS,
	clipSources: [
		clip({
			id: "v",
			resourceId: "res-v",
			resourceKind: "video",
			start: 0,
			duration: SOURCE_SECONDS,
		}),
	],
};
const assetPaths = { "res-v": sourcePath };
const benchSource: PreviewSource = {
	revision: "bench",
	plan,
	assetPaths,
	contentKeys: { "res-v": "bench/bench-1080p" },
};

const percentile = (sorted: number[], p: number): number =>
	sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const stats = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		min: sorted[0],
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		max: sorted[sorted.length - 1],
	};
};

const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;
const ms = (value: number): string => value.toFixed(1);

// Deterministic pseudo-random seek times (no Math.random: reproducible runs).
const seekTimes = (count: number): number[] => {
	let seed = 12345;
	return Array.from({ length: count }, () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return (seed / 0x7fffffff) * (SOURCE_SECONDS - 2);
	});
};

const gc = (): void => {
	(globalThis as { gc?: () => void }).gc?.();
};

interface SeekScrub {
	seekLatencyMs: ReturnType<typeof stats>;
	scrub: { delivered: number; decodes: number; coalesced: number; cancelled: number };
	proxyDecodes: number;
}

/** Cold seeks one at a time, then a scrub burst; null = originals only. */
const measureSeekAndScrub = async (
	proxies: PreviewProxyCache | null,
): Promise<SeekScrub> => {
	// 1. Cold seek latency: one request at a time, distinct frame slots.
	const producer = createPreviewProducer({
		ffmpegPath: FFMPEG,
		width: W,
		height: H,
		cacheCapacity: 0,
		proxies: proxies ?? undefined,
	});
	producer.setSource(benchSource);
	const seekLatencies: number[] = [];
	let generation = 0;
	for (const time of seekTimes(SEEKS)) {
		generation += 1;
		const started = performance.now();
		await new Promise<void>((resolve) => {
			producer.onFrame((frame) => {
				frame.release();
				resolve();
			});
			producer.request(time, generation);
		});
		seekLatencies.push(performance.now() - started);
	}
	const seekProxyDecodes = producer.stats().proxyDecodes;
	if (proxies && seekProxyDecodes !== SEEKS) {
		throw new Error(`expected every seek from the proxy, got ${seekProxyDecodes}`);
	}
	await producer.dispose();

	// 2. Scrub: requests faster than a decode completes; newest wins.
	const scrubber = createPreviewProducer({
		ffmpegPath: FFMPEG,
		width: W,
		height: H,
		cacheCapacity: 0,
		proxies: proxies ?? undefined,
	});
	scrubber.setSource(benchSource);
	let delivered = 0;
	scrubber.onFrame((frame) => {
		delivered += 1;
		frame.release();
	});
	const times = seekTimes(SCRUB_REQUESTS);
	for (let i = 0; i < times.length; i += 1) {
		scrubber.request(times[i], i + 1);
		await new Promise((resolve) => setTimeout(resolve, SCRUB_INTERVAL_MS));
	}
	await scrubber.idle();
	const scrubStats = scrubber.stats();
	await scrubber.dispose();
	return {
		seekLatencyMs: stats(seekLatencies),
		scrub: {
			delivered,
			decodes: scrubStats.decodes,
			coalesced: scrubStats.coalesced,
			cancelled: scrubStats.cancelled,
		},
		proxyDecodes: seekProxyDecodes + scrubStats.proxyDecodes,
	};
};

/** Range stream from t=2s: frames/s and drops with a releasing consumer. */
const measureStream = async (paths: Record<string, string>) => {
	const pool = createFramePool({ byteLength: W * H * 4, capacity: 4 });
	let firstAt = 0;
	let lastAt = 0;
	let count = 0;
	const streamStarted = performance.now();
	const outcome = await startPreviewDecode({
		ffmpegPath: FFMPEG,
		plan,
		assetPaths: paths,
		width: W,
		height: H,
		timeSeconds: 2,
		frameCount: STREAM_FRAMES,
		generation: 1,
		streamId: "bench",
		pool,
		onFrame: (frame) => {
			count += 1;
			lastAt = performance.now();
			if (count === 1) firstAt = lastAt;
			frame.release();
		},
	}).outcome;
	if (outcome.status !== "done") throw new Error(`stream failed: ${JSON.stringify(outcome)}`);
	const steadyFps = count > 1 ? ((count - 1) / (lastAt - firstAt)) * 1000 : 0;
	return {
		frames: count,
		dropped: outcome.dropped,
		firstFrameMs: firstAt - streamStarted,
		steadyFps,
		realtimeFactor: steadyFps / FPS,
	};
};

/** Bare ffmpeg process start + exit: the floor for one-process-per-seek. */
const measureSpawnFloor = async () => {
	const samples: number[] = [];
	for (let i = 0; i < 10; i += 1) {
		const started = performance.now();
		const result = await runCaptured(
			FFMPEG,
			["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16", "-frames:v", "1", "-f", "null", "-"],
			{ timeoutMs: 10_000 },
		);
		if (result.exitCode !== 0) throw new Error(`spawn floor failed: ${result.stderr}`);
		samples.push(performance.now() - started);
	}
	return stats(samples);
};

const run = async () => {
	await ensureSource();
	const version = (await runCaptured(FFMPEG, ["-version"], { timeoutMs: 10_000 })).stdout.split("\n")[0];

	const spawnFloorMs = await measureSpawnFloor();
	gc();
	const memStart = process.memoryUsage();
	const original = await measureSeekAndScrub(null);
	const originalStream = await measureStream(assetPaths);

	// Proxy: generated into a fresh directory so its cost is measured too.
	const proxyDir = await mkdtemp(path.join(os.tmpdir(), "minicut-bench-proxy-"));
	const proxies = createPreviewProxyCache({
		dir: proxyDir,
		mediaService: createMediaService({ ffmpegPath: FFMPEG }),
	});
	const proxyStarted = performance.now();
	const proxyPath = await proxies.ensure({ contentKey: "bench/bench-1080p", sourcePath });
	const proxyGenerationMs = performance.now() - proxyStarted;
	const proxyBytes = (await stat(proxyPath)).size;
	const proxied = await measureSeekAndScrub(proxies);
	const proxiedStream = await measureStream({ "res-v": proxyPath });
	await proxies.dispose();
	await rm(proxyDir, { recursive: true, force: true });

	gc();
	const memEnd = process.memoryUsage();
	const sourceBytes = (await stat(sourcePath)).size;
	const params = DEFAULT_PREVIEW_PROXY_PARAMS;

	return {
		machine: {
			os: `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`,
			cpu: `${os.cpus()[0]?.model.trim()} x${os.cpus().length}`,
			memoryGB: Math.round(os.totalmem() / 1024 ** 3),
			node: process.version,
			ffmpeg: version,
			gcExposed: typeof (globalThis as { gc?: unknown }).gc === "function",
		},
		source: `1920x1080 ${FPS}fps H.264 (veryfast, default GOP), ${SOURCE_SECONDS}s, ${mb(sourceBytes)} MB`,
		proxy: {
			params: `H.264 ${params.allIntra ? "all-intra" : `GOP ${params.gopSize ?? 12}`}, ${params.height}p (CRF 23, veryfast)`,
			generationMs: proxyGenerationMs,
			sizeMB: mb(proxyBytes),
		},
		spawnFloorMs,
		previewSize: `${W}x${H} RGBA (${mb(W * H * 4)} MB/frame)`,
		original: { ...original, stream: originalStream },
		proxied: { ...proxied, stream: proxiedStream },
		memory: {
			rssStartMB: mb(memStart.rss),
			rssEndMB: mb(memEnd.rss),
			rssGrowthMB: mb(memEnd.rss - memStart.rss),
			heapGrowthMB: mb(memEnd.heapUsed - memStart.heapUsed),
			externalGrowthMB: mb(memEnd.external - memStart.external),
			arrayBuffersGrowthMB: mb(memEnd.arrayBuffers - memStart.arrayBuffers),
		},
	};
};

type Result = Awaited<ReturnType<typeof run>>;
type Measured = Result["original"];

const seekRow = (name: string, m: Measured): string =>
	`| ${name} | ${ms(m.seekLatencyMs.p50)} ms | ${ms(m.seekLatencyMs.p95)} ms | ${ms(m.seekLatencyMs.min)} ms | ${ms(m.seekLatencyMs.max)} ms |`;
const scrubRow = (name: string, m: Measured): string =>
	`| ${name} | ${m.scrub.delivered} | ${m.scrub.decodes} | ${m.scrub.coalesced} | ${m.scrub.cancelled} |`;
const streamRow = (name: string, m: Measured): string =>
	`| ${name} | ${ms(m.stream.firstFrameMs)} ms | ${m.stream.steadyFps.toFixed(1)} (${m.stream.realtimeFactor.toFixed(1)}x of ${FPS} fps) | ${m.stream.dropped} |`;

const toMarkdown = (r: Result): string =>
	[
		"# Preview producer benchmark",
		"",
		"Generated by `scripts/bench-preview.ts` (Node frame producer, FFmpeg CLI decode, one process per decode).",
		"Numbers are for the machine below only; do not compare across machines.",
		"",
		"## Machine",
		"",
		`- OS: ${r.machine.os}`,
		`- CPU: ${r.machine.cpu}, ${r.machine.memoryGB} GB RAM`,
		`- Node: ${r.machine.node}; GC exposed: ${r.machine.gcExposed}`,
		`- ${r.machine.ffmpeg}`,
		`- Source: ${r.source}`,
		`- Scrub proxy: ${r.proxy.params}, ${r.proxy.sizeMB} MB, generated in ${(r.proxy.generationMs / 1000).toFixed(1)} s`,
		`- Preview: ${r.previewSize}`,
		"",
		`## Cold seek latency (${SEEKS} seeks, request to delivered frame)`,
		"",
		"| Input | p50 | p95 | min | max |",
		"| --- | --- | --- | --- | --- |",
		seekRow("original", r.original),
		seekRow("proxy", r.proxied),
		"",
		`Floor: a bare ffmpeg process (lavfi 16x16, one frame, null output) takes p50 ${ms(r.spawnFloorMs.p50)} ms, p95 ${ms(r.spawnFloorMs.p95)} ms here.`,
		"",
		`## Scrub (${SCRUB_REQUESTS} requests, one every ${SCRUB_INTERVAL_MS} ms)`,
		"",
		"| Input | frames delivered | decodes | coalesced | cancelled |",
		"| --- | --- | --- | --- | --- |",
		scrubRow("original", r.original),
		scrubRow("proxy", r.proxied),
		"",
		`## Range stream (${STREAM_FRAMES} frames from 2 s, consumer releases at once)`,
		"",
		"| Input | first frame | steady frames/s | dropped (pool exhausted) |",
		"| --- | --- | --- | --- |",
		streamRow("original", r.original),
		streamRow("proxy", r.proxied),
		"",
		"## Memory growth over the whole run (after GC when exposed)",
		"",
		`- RSS: ${r.memory.rssStartMB} MB -> ${r.memory.rssEndMB} MB (growth ${r.memory.rssGrowthMB} MB)`,
		`- JS heap growth: ${r.memory.heapGrowthMB} MB; external: ${r.memory.externalGrowthMB} MB; ArrayBuffers: ${r.memory.arrayBuffersGrowthMB} MB`,
		"",
		"## Reading the numbers",
		"",
		"- Seek on the original is ffmpeg process start plus decoding from the previous keyframe at 1080p. On the all-intra proxy a seek decodes one 540p frame, so most of what remains is process start; a persistent decoder would remove that.",
		"- The proxy is used only once it is ready (generated lazily per content key, cached on disk); before that and after a failed generation the producer decodes the original. Export always reads originals; `previewProxy.media.test.ts` checks preview-from-proxy against export frames by SSIM at proxy resolution.",
		"- Scrub: a running single-frame decode is never cancelled; at most one newer request waits behind it (older waiting ones are coalesced). Frames are therefore produced continuously while requests keep arriving, about one per decode time.",
		"- Range streaming is decoder-only for now (startPreviewDecode with pooled buffers, drop on pool exhaustion); there is no producer-level stream queue or backpressure yet.",
		"- Memory: pool and cache are bounded (pool capacity x frame bytes plus cache capacity x frame bytes); growth beyond that would indicate a leak.",
		"",
	].join("\n");

const main = async () => {
	const result = await run();
	const markdown = toMarkdown(result);
	console.log(markdown);
	const outIndex = process.argv.indexOf("--out");
	if (outIndex >= 0 && process.argv[outIndex + 1]) {
		await writeFile(path.resolve(process.argv[outIndex + 1]), markdown, "utf8");
	}
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
