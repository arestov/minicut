import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_PREVIEW_PROXY_PARAMS,
	previewProxyFileName,
	createPreviewProxyCache,
	previewProxyParamsKey,
} from "./previewProxyCache";

describe("preview proxy cache naming", () => {
	it("defaults to an all-intra 540p proxy", () => {
		expect(previewProxyParamsKey(DEFAULT_PREVIEW_PROXY_PARAMS)).toBe(
			"h264-v2-noaudio-h540-intra",
		);
		expect(previewProxyParamsKey({ height: 360, allIntra: false })).toBe(
			"h264-v2-noaudio-h360-gop12",
		);
	});

	it("names files by content key and parameters only", () => {
		const params = DEFAULT_PREVIEW_PROXY_PARAMS;
		const name = previewProxyFileName("sha256-chain-v2/abc", params);
		expect(name).toMatch(/^[0-9a-f]{64}\.mp4$/);
		expect(previewProxyFileName("sha256-chain-v2/abc", { ...params })).toBe(name);
		expect(previewProxyFileName("sha256-chain-v2/abd", params)).not.toBe(name);
		expect(
			previewProxyFileName("sha256-chain-v2/abc", { ...params, height: 360 }),
		).not.toBe(name);
		expect(
			previewProxyFileName("sha256-chain-v2/abc", { ...params, allIntra: false }),
		).not.toBe(name);
	});
});

describe("preview proxy cache startup", () => {
	it("removes orphan .part files and keeps finished proxies", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "minicut-proxy-orphans-"));
		try {
			await writeFile(path.join(dir, ".abc.job-1.part.mp4"), "partial");
			await writeFile(path.join(dir, "done.mp4"), "complete");
			createPreviewProxyCache({
				dir,
				mediaService: { generateProxy: () => { throw new Error("unused"); } },
			});
			expect(await readdir(dir)).toEqual(["done.mp4"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("tolerates a cache directory that does not exist yet", () => {
		expect(() =>
			createPreviewProxyCache({
				dir: path.join(os.tmpdir(), "minicut-proxy-missing-dir-xyz"),
				mediaService: { generateProxy: () => { throw new Error("unused"); } },
			}),
		).not.toThrow();
	});
});
