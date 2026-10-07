import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaService } from "../mediaService";
import { runCaptured } from "../processRunner";
import { ensureFixtures, type FixtureName } from "../testing/mediaFixtures";
import { createPreviewProxyCache } from "./previewProxyCache";

const PARAMS = { height: 120, allIntra: true };

describe("preview proxy cache against fixtures", () => {
	let fixtures: Record<FixtureName, string>;
	let dir: string;

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr", "audio-tone"]);
		dir = await mkdtemp(path.join(os.tmpdir(), "minicut-proxy-cache-"));
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const createCache = (cacheDir: string) => {
		const pids: number[] = [];
		const cache = createPreviewProxyCache({
			dir: cacheDir,
			mediaService: createMediaService({ onProcessStart: (pid) => pids.push(pid) }),
			params: PARAMS,
		});
		return { cache, pids };
	};

	it("generates one all-intra proxy for concurrent requests and reuses it after a restart", async () => {
		const cacheDir = path.join(dir, "reuse");
		const source = { contentKey: "test/video-cfr", sourcePath: fixtures["video-cfr"] };
		const first = createCache(cacheDir);
		expect(first.cache.ready(source.contentKey)).toBeNull();
		const [a, b] = await Promise.all([
			first.cache.ensure(source),
			first.cache.ensure(source),
		]);
		expect(a).toBe(b);
		expect(first.pids).toHaveLength(1);
		expect(first.cache.ready(source.contentKey)).toBe(a);
		expect(await readdir(cacheDir)).toEqual([path.basename(a)]);

		const keyframes = await runCaptured(
			"ffprobe",
			[
				"-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
				"-show_entries", "frame=pts_time", "-of", "csv=p=0", a,
			],
			{ timeoutMs: 30_000 },
		);
		expect(keyframes.stdout.split("\n").filter((l) => l.trim())).toHaveLength(50);

		// A new cache over the same directory finds the file without ffmpeg.
		const second = createCache(cacheDir);
		expect(await second.cache.ensure(source)).toBe(a);
		expect(second.pids).toHaveLength(0);
	});

	it("keys files by content, not by source path", async () => {
		const cacheDir = path.join(dir, "content");
		const { cache, pids } = createCache(cacheDir);
		const original = await cache.ensure({
			contentKey: "test/same",
			sourcePath: fixtures["video-cfr"],
		});
		// Same content at another path (e.g. relinked): no new generation.
		const relinked = await cache.ensure({
			contentKey: "test/same",
			sourcePath: path.join(dir, "moved.mp4"),
		});
		expect(relinked).toBe(original);
		expect(pids).toHaveLength(1);
		await cache.dispose();
	});

	it("rejects typed for a source without video and remembers the failure", async () => {
		const { cache, pids } = createCache(path.join(dir, "fail"));
		const source = { contentKey: "test/audio", sourcePath: fixtures["audio-tone"] };
		await expect(cache.ensure(source)).rejects.toMatchObject({
			code: "invalid-request",
		});
		await expect(cache.ensure(source)).rejects.toMatchObject({
			code: "invalid-request",
		});
		expect(cache.ready(source.contentKey)).toBeNull();
		expect(pids).toHaveLength(0); // failed at probe, before any ffmpeg encode
	});

	it("dispose cancels a running generation and leaves no file", async () => {
		const cacheDir = path.join(dir, "cancel");
		const { cache } = createCache(cacheDir);
		const pending = cache.ensure({
			contentKey: "test/cancel",
			sourcePath: fixtures["video-cfr"],
		});
		await cache.dispose();
		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
		expect(cache.ready("test/cancel")).toBeNull();
		const left = await readdir(cacheDir).catch(() => [] as string[]);
		expect(left).toEqual([]);
	});
});
