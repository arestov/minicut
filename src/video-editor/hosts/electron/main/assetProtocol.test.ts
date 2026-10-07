import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IpcMainEvent } from "electron";
import { registerAssetIpc } from "./assetIpc";
import { createHostAssetRegistry } from "./assetRegistry";
import { parseRangeHeader } from "./fileResponse";
import { createMiniCutProtocolHandler } from "./protocolHandler";
import { isUrlUnderPrefix } from "./windowConnector";
import {
	createAssetUrl,
	ELECTRON_IPC,
	MINICUT_APP_URL_PREFIX,
	parseAssetUrl,
	type DesktopAssetRegistration,
} from "../shared/ipcChannels";

const MEDIA_BYTES = Buffer.from(
	Array.from({ length: 1000 }, (_, index) => index % 251),
);

describe("asset protocol", () => {
	let tempDir: string;
	let mediaPath: string;
	let rendererDir: string;
	let assets: ReturnType<typeof createHostAssetRegistry>;
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
		assets = createHostAssetRegistry({ generateId: () => "asset-1" });
		const registration = assets.register(mediaPath, 1);
		if (!registration.ok) throw new Error(registration.reason);
		assetId = registration.assetId;
		handler = createMiniCutProtocolHandler({ assets, rendererDir });
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

	describe("registry", () => {
		it("registers an existing absolute file and reports its metadata", () => {
			expect(assets.register(mediaPath, 1)).toEqual({
				ok: true,
				assetId: "asset-1",
				name: "clip.mp4",
				size: MEDIA_BYTES.length,
			});
		});

		it("refuses relative paths, directories, missing files and non-strings", () => {
			expect(assets.register("clip.mp4", 1)).toMatchObject({ ok: false });
			expect(assets.register(tempDir, 1)).toMatchObject({ ok: false });
			expect(assets.register(path.join(tempDir, "missing.mp4"), 1)).toMatchObject({
				ok: false,
			});
			expect(assets.register(42, 1)).toMatchObject({ ok: false });
		});

		it("forgets a released asset", () => {
			expect(assets.release(assetId, 1)).toBe(true);
			expect(assets.resolve(assetId)).toBeNull();
			expect(assets.release(assetId, 1)).toBe(false);
		});
	});

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
			const registration = createHostAssetRegistry({ generateId: () => "empty" });
			registration.register(emptyPath, 1);
			const emptyHandler = createMiniCutProtocolHandler({
				assets: registration,
				rendererDir,
			});

			const response = await emptyHandler(new Request(absolute(createAssetUrl("empty"))));

			expect(response.status).toBe(200);
			expect(response.headers.get("content-length")).toBe("0");
			expect((await bytesOf(response)).length).toBe(0);
		});
	});

	describe("routing", () => {
		it("answers 404 for an unknown or released asset", async () => {
			assets.release(assetId, 1);

			expect((await get(createAssetUrl(assetId))).status).toBe(404);
			expect((await get(createAssetUrl("nope"))).status).toBe(404);
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
		it("refuses network and device paths and files that are not video, audio or raster images", async () => {
			await writeFile(path.join(tempDir, "notes.txt"), "text");
			await writeFile(path.join(tempDir, "drawing.svg"), "<svg/>");

			expect(assets.register("\\\\server\\share\\clip.mp4", 1)).toMatchObject({ ok: false });
			expect(assets.register("\\\\?\\C:\\clip.mp4", 1)).toMatchObject({ ok: false });
			expect(assets.register("//server/share/clip.mp4", 1)).toMatchObject({ ok: false });
			expect(assets.register(path.join(tempDir, "notes.txt"), 1)).toMatchObject({ ok: false });
			expect(assets.register(path.join(tempDir, "drawing.svg"), 1)).toMatchObject({ ok: false });
		});

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

		it("lets only the owner release an asset and releases everything of an owner at once", () => {
			const registry = createHostAssetRegistry();
			const mine = registry.register(mediaPath, 1);
			const theirs = registry.register(mediaPath, 2);
			if (!mine.ok || !theirs.ok) throw new Error("registration failed");

			expect(registry.release(mine.assetId, 2)).toBe(false);
			expect(registry.releaseOwner(1)).toBe(1);
			expect(registry.resolve(mine.assetId)).toBeNull();
			expect(registry.resolve(theirs.assetId)).toBe(mediaPath);
		});
	});

	describe("asset IPC", () => {
		const createIpc = () => {
			const listeners = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>();
			return {
				on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void) {
					listeners.set(channel, listener);
				},
				removeListener(channel: string) {
					listeners.delete(channel);
				},
				invoke(channel: string, event: unknown, ...args: unknown[]) {
					listeners.get(channel)?.(event as IpcMainEvent, ...args);
				},
				size: () => listeners.size,
			};
		};
		const app = (url: string) => `${MINICUT_APP_URL_PREFIX}${url}`;
		const createSender = (id: number, frameUrl = app("index.html")) => {
			const mainFrame = { url: frameUrl };
			const sender = Object.assign(new EventEmitter(), { id, mainFrame });
			return {
				sender,
				event: () => ({ sender, senderFrame: mainFrame, returnValue: undefined as unknown }),
			};
		};
		const trusts = (url: string) => isUrlUnderPrefix(url, MINICUT_APP_URL_PREFIX);

		it("registers a path from a trusted frame and returns the asset URL", () => {
			const ipc = createIpc();
			registerAssetIpc({ assets, ipcMain: ipc, isTrustedRendererUrl: trusts });
			const event = createSender(7).event();

			ipc.invoke(ELECTRON_IPC.ASSET_REGISTER, event, mediaPath);

			expect(event.returnValue).toEqual({
				ok: true,
				assetId: "asset-1",
				url: createAssetUrl("asset-1"),
				name: "clip.mp4",
				size: MEDIA_BYTES.length,
			} satisfies DesktopAssetRegistration);
		});

		it("refuses untrusted senders, including a lookalike host", () => {
			const ipc = createIpc();
			registerAssetIpc({ assets, ipcMain: ipc, isTrustedRendererUrl: trusts });
			const lookalike = createSender(8, "minicut://local/application/index.html").event();
			const foreign = createSender(9, "https://example.com/").event();

			ipc.invoke(ELECTRON_IPC.ASSET_REGISTER, lookalike, mediaPath);
			ipc.invoke(ELECTRON_IPC.ASSET_REGISTER, foreign, mediaPath);

			expect(lookalike.returnValue).toEqual({ ok: false, reason: "untrusted sender" });
			expect(foreign.returnValue).toEqual({ ok: false, reason: "untrusted sender" });
		});

		it("releases only the sender's own assets", () => {
			const ipc = createIpc();
			registerAssetIpc({ assets, ipcMain: ipc, isTrustedRendererUrl: trusts });
			const owner = createSender(7);
			const other = createSender(8);
			const registered = owner.event();
			ipc.invoke(ELECTRON_IPC.ASSET_REGISTER, registered, mediaPath);
			const { assetId: ownedId } = registered.returnValue as { assetId: string };

			ipc.invoke(ELECTRON_IPC.ASSET_RELEASE, other.event(), ownedId);
			expect(assets.resolve(ownedId)).toBe(mediaPath);

			ipc.invoke(ELECTRON_IPC.ASSET_RELEASE, owner.event(), ownedId);
			expect(assets.resolve(ownedId)).toBeNull();
		});

		it("releases a window's assets when it is destroyed or its main frame navigates", () => {
			const ipc = createIpc();
			const registry = createHostAssetRegistry();
			const { dispose } = registerAssetIpc({
				assets: registry,
				ipcMain: ipc,
				isTrustedRendererUrl: trusts,
			});
			const reloaded = createSender(7);
			const closed = createSender(8);
			const sameDocument = createSender(9);
			for (const window of [reloaded, closed, sameDocument]) {
				ipc.invoke(ELECTRON_IPC.ASSET_REGISTER, window.event(), mediaPath);
			}
			expect(registry.size()).toBe(3);

			sameDocument.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
			expect(registry.size()).toBe(3);
			reloaded.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
			expect(registry.size()).toBe(2);
			closed.sender.emit("destroyed");
			expect(registry.size()).toBe(1);

			dispose();
			expect(ipc.size()).toBe(0);
			expect(closed.sender.listenerCount("destroyed")).toBe(0);
		});
	});
});
