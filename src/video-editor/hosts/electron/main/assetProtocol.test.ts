import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createNodeAssetRegistry,
	type NodeAssetRegistry,
} from "../../../adapters/node/nodeAssetRegistry";
import { parseRangeHeader } from "./fileResponse";
import { createMiniCutProtocolHandler, createRegistryAssetSource } from "./protocolHandler";
import {
	createAssetUrl,
	MINICUT_APP_URL_PREFIX,
	parseAssetUrl,
} from "../shared/ipcChannels";

const MEDIA_BYTES = Buffer.from(
	Array.from({ length: 1000 }, (_, index) => index % 251),
);

describe("asset protocol", () => {
	let tempDir: string;
	let mediaPath: string;
	let rendererDir: string;
	let registry: NodeAssetRegistry;
	let handler: (request: Request) => Promise<Response>;
	let assetId: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-asset-protocol-"));
		mediaPath = path.join(tempDir, "clip.mp4");
		rendererDir = path.join(tempDir, "renderer");
		await mkdir(path.join(rendererDir, "assets"), { recursive: true });
		await writeFile(mediaPath, MEDIA_BYTES);
		await writeFile(path.join(rendererDir, "index.html"), "<html></html>");
		await writeFile(path.join(rendererDir, "assets", "app.js"), "export {}");
		await writeFile(path.join(tempDir, "secret.txt"), "secret");
		registry = await createNodeAssetRegistry({
			filePath: path.join(tempDir, "assets.json"),
			generateId: () => "asset-1",
		});
		assetId = (await registry.register(mediaPath)).assetId;
		handler = createMiniCutProtocolHandler({
			assets: createRegistryAssetSource(registry),
			rendererDir,
		});
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	/** Resolves an origin-relative asset URL the way the renderer page does. */
	const absolute = (url: string) =>
		new URL(url, `${MINICUT_APP_URL_PREFIX}index.html`).href;
	const get = (url: string, headers: Record<string, string> = {}, method = "GET") =>
		handler(new Request(absolute(url), { method, headers }));
	const bytesOf = async (response: Response) =>
		Buffer.from(await response.arrayBuffer());

	describe("asset URLs", () => {
		it("round-trips an asset id through the URL", () => {
			expect(createAssetUrl("a1")).toBe("/asset/a1");
			expect(parseAssetUrl(createAssetUrl("a b/c"))).toBe("a b/c");
			expect(parseAssetUrl(absolute(createAssetUrl("a1")))).toBe("a1");
			expect(parseAssetUrl("blob:http://x/1")).toBeNull();
			expect(parseAssetUrl(`${MINICUT_APP_URL_PREFIX}index.html`)).toBeNull();
		});
	});

	describe("Range requests", () => {
		it("serves the whole file with Accept-Ranges", async () => {
			const response = await get(createAssetUrl(assetId));

			expect(response.status).toBe(200);
			expect(response.headers.get("accept-ranges")).toBe("bytes");
			expect(response.headers.get("content-type")).toBe("video/mp4");
			expect(response.headers.get("content-length")).toBe("1000");
			expect(await bytesOf(response)).toEqual(MEDIA_BYTES);
		});

		it("serves a closed range as 206 with Content-Range", async () => {
			const response = await get(createAssetUrl(assetId), { Range: "bytes=100-199" });

			expect(response.status).toBe(206);
			expect(response.headers.get("content-range")).toBe("bytes 100-199/1000");
			expect(response.headers.get("content-length")).toBe("100");
			expect(await bytesOf(response)).toEqual(MEDIA_BYTES.subarray(100, 200));
		});

		it("serves an open-ended range and clamps an end beyond the file", async () => {
			const open = await get(createAssetUrl(assetId), { Range: "bytes=990-" });
			const clamped = await get(createAssetUrl(assetId), { Range: "bytes=995-5000" });

			expect(open.headers.get("content-range")).toBe("bytes 990-999/1000");
			expect(await bytesOf(open)).toEqual(MEDIA_BYTES.subarray(990));
			expect(clamped.headers.get("content-range")).toBe("bytes 995-999/1000");
			expect(await bytesOf(clamped)).toEqual(MEDIA_BYTES.subarray(995));
		});

		it("serves a suffix range (the tail of the file)", async () => {
			const response = await get(createAssetUrl(assetId), { Range: "bytes=-10" });

			expect(response.status).toBe(206);
			expect(response.headers.get("content-range")).toBe("bytes 990-999/1000");
			expect(await bytesOf(response)).toEqual(MEDIA_BYTES.subarray(990));
		});

		it("answers an unsatisfiable range with 416 and the file size", async () => {
			const response = await get(createAssetUrl(assetId), { Range: "bytes=2000-3000" });

			expect(response.status).toBe(416);
			expect(response.headers.get("content-range")).toBe("bytes */1000");
		});

		it("serves the whole file for a multi-range request it does not support", async () => {
			const response = await get(createAssetUrl(assetId), { Range: "bytes=0-1,5-9" });

			expect(response.status).toBe(200);
			expect(await bytesOf(response)).toEqual(MEDIA_BYTES);
		});

		it("answers HEAD without a body and rejects other methods", async () => {
			const head = await get(createAssetUrl(assetId), { Range: "bytes=0-9" }, "HEAD");
			const post = await get(createAssetUrl(assetId), {}, "POST");

			expect(head.status).toBe(206);
			expect(head.headers.get("content-length")).toBe("10");
			expect((await bytesOf(head)).length).toBe(0);
			expect(post.status).toBe(405);
		});

		it("parses range headers", () => {
			expect(parseRangeHeader(null, 10)).toBeNull();
			expect(parseRangeHeader("items=0-1", 10)).toBeNull();
			expect(parseRangeHeader("bytes=-", 10)).toBe("unsatisfiable");
			expect(parseRangeHeader("bytes=5-2", 10)).toBe("unsatisfiable");
			expect(parseRangeHeader("bytes=-0", 10)).toBe("unsatisfiable");
			expect(parseRangeHeader("bytes=0-0", 0)).toBe("unsatisfiable");
			expect(parseRangeHeader("bytes=-100", 10)).toEqual({ start: 0, end: 9 });
		});

		it("serves an empty file without a body", async () => {
			const emptyPath = path.join(tempDir, "empty.wav");
			await writeFile(emptyPath, "");
			const emptyRegistry = await createNodeAssetRegistry({
				filePath: path.join(tempDir, "empty-assets.json"),
				generateId: () => "empty",
			});
			await emptyRegistry.register(emptyPath);
			const emptyHandler = createMiniCutProtocolHandler({
				assets: createRegistryAssetSource(emptyRegistry),
				rendererDir,
			});

			const response = await emptyHandler(new Request(absolute(createAssetUrl("empty"))));

			expect(response.status).toBe(200);
			expect(response.headers.get("content-length")).toBe("0");
			expect((await bytesOf(response)).length).toBe(0);
		});
	});

	describe("routing", () => {
		it("answers 404 for an id the registry does not know", async () => {
			expect((await get(createAssetUrl(assetId))).status).toBe(200);
			expect((await get(createAssetUrl("nope"))).status).toBe(404);
		});

		it("serves an asset id again after the registry was reopened from disk", async () => {
			await registry.flush();
			const reopened = await createNodeAssetRegistry({
				filePath: path.join(tempDir, "assets.json"),
			});
			const reopenedHandler = createMiniCutProtocolHandler({
				assets: createRegistryAssetSource(reopened),
				rendererDir,
			});

			const response = await reopenedHandler(new Request(absolute(createAssetUrl(assetId))));

			expect(response.status).toBe(200);
			expect(await bytesOf(response)).toEqual(MEDIA_BYTES);
		});

		it("serves a relinked asset id from its new file", async () => {
			const other = path.join(tempDir, "other.mp4");
			await writeFile(other, Buffer.from([1, 2, 3]));
			await registry.relink(assetId, other);

			const response = await get(createAssetUrl(assetId));

			expect(await bytesOf(response)).toEqual(Buffer.from([1, 2, 3]));
		});

		it("serves the renderer bundle under /app/ and index.html by default", async () => {
			const index = await get(`${MINICUT_APP_URL_PREFIX}index.html`);
			const root = await get(MINICUT_APP_URL_PREFIX);
			const script = await get(`${MINICUT_APP_URL_PREFIX}assets/app.js`);

			expect(await index.text()).toBe("<html></html>");
			expect(await root.text()).toBe("<html></html>");
			expect(script.headers.get("content-type")).toContain("text/javascript");
		});

		it("does not serve files outside the renderer directory", async () => {
			const escaped = await get(`${MINICUT_APP_URL_PREFIX}..%2Fsecret.txt`);
			const dotted = await get(`${MINICUT_APP_URL_PREFIX}%2e%2e/secret.txt`);

			expect(escaped.status).toBe(404);
			expect(dotted.status).toBe(404);
		});

		it("answers 404 for other hosts, schemes and paths", async () => {
			expect((await get("minicut://other/app/index.html")).status).toBe(404);
			expect((await get("https://local/app/index.html")).status).toBe(404);
			expect((await get("minicut://local/elsewhere")).status).toBe(404);
		});
	});

	describe("hardening", () => {
		it("serves media with nosniff and a sandbox policy, and the bundle with a CSP", async () => {
			const media = await get(createAssetUrl(assetId));
			const page = await get(`${MINICUT_APP_URL_PREFIX}index.html`);

			expect(media.headers.get("x-content-type-options")).toBe("nosniff");
			expect(media.headers.get("content-security-policy")).toBe("sandbox");
			expect(page.headers.get("x-content-type-options")).toBe("nosniff");
			const csp = page.headers.get("content-security-policy") ?? "";
			expect(csp).toContain("default-src 'self'");
			expect(csp).toContain("object-src 'none'");
			expect(csp).toContain("frame-ancestors 'none'");
			expect(csp).not.toContain("'unsafe-eval'");
		});

		it("does not serve a registered path that is not media", async () => {
			const notMedia = path.join(tempDir, "secret.txt");
			const handlerWithText = createMiniCutProtocolHandler({
				assets: { resolve: () => notMedia },
				rendererDir,
			});

			const response = await handlerWithText(new Request(absolute(createAssetUrl("any"))));

			expect(response.status).toBe(404);
		});
	});
});
