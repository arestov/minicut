import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createNodeAssetRegistry,
	NodeAssetRegistryError,
} from "./nodeAssetRegistry";

describe("createNodeAssetRegistry", () => {
	let dir: string;
	let registryFile: string;
	let counter: number;
	const generateId = () => `asset_${++counter}`;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "minicut-assets-"));
		registryFile = path.join(dir, "ws", "assets.json");
		counter = 0;
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const media = (name: string) => path.join(dir, name);

	it("registers a file once and gives the same id for the same path", async () => {
		const registry = await createNodeAssetRegistry({
			filePath: registryFile,
			generateId,
		});
		const first = await registry.register(media("a.mp4"));
		const again = await registry.register(media("a.mp4"));
		const other = await registry.register(media("b.mp4"));

		expect(again).toEqual(first);
		expect(first.assetId).toBe("asset_1");
		expect(other.assetId).toBe("asset_2");
		expect(registry.get("asset_1")?.path).toBe(media("a.mp4"));
	});

	it("persists per workspace file and restores ids after reopening", async () => {
		const registry = await createNodeAssetRegistry({
			filePath: registryFile,
			generateId,
		});
		const record = await registry.register(media("a.mp4"));
		await registry.flush();

		const reopened = await createNodeAssetRegistry({
			filePath: registryFile,
			generateId,
		});
		expect(reopened.list()).toEqual([record]);
		expect((await reopened.register(media("a.mp4"))).assetId).toBe(
			record.assetId,
		);
	});

	it("resolves to a location only while the file exists", async () => {
		const registry = await createNodeAssetRegistry({
			filePath: registryFile,
			generateId,
		});
		const file = media("a.mp4");
		await writeFile(file, "x");
		const record = await registry.register(file);

		expect(await registry.resolve(record.assetId)).toEqual({
			ok: true,
			location: { path: file },
		});

		await rm(file);
		const missing = await registry.resolve(record.assetId);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error.code).toBe("asset-not-found");

		const unknown = await registry.resolve("nope");
		expect(unknown.ok).toBe(false);
	});

	it("relinks an asset id to another file and keeps the id", async () => {
		const registry = await createNodeAssetRegistry({
			filePath: registryFile,
			generateId,
		});
		const record = await registry.register(media("a.mp4"));
		const next = await registry.relink(record.assetId, media("moved.mp4"));
		await registry.flush();

		expect(next).toEqual({ assetId: record.assetId, path: media("moved.mp4") });
		const reopened = await createNodeAssetRegistry({
			filePath: registryFile,
			generateId,
		});
		expect(reopened.get(record.assetId)?.path).toBe(media("moved.mp4"));
		// The old path is free again and becomes a new asset.
		expect((await reopened.register(media("a.mp4"))).assetId).not.toBe(
			record.assetId,
		);
		await expect(
			reopened.relink("missing-id", media("x.mp4")),
		).rejects.toMatchObject({ code: "unknown_asset" });
	});

	it("rejects relative paths", async () => {
		const registry = await createNodeAssetRegistry({
			filePath: registryFile,
			generateId,
		});
		await expect(registry.register("relative/a.mp4")).rejects.toMatchObject({
			code: "invalid_path",
		});
	});

	it("never replaces a corrupt or newer registry silently", async () => {
		await mkdir(path.dirname(registryFile), { recursive: true });

		await writeFile(registryFile, "{not json");
		await expect(
			createNodeAssetRegistry({ filePath: registryFile }),
		).rejects.toBeInstanceOf(NodeAssetRegistryError);

		const newer = JSON.stringify({
			kind: "minicut-asset-registry",
			version: 99,
			assets: [],
		});
		await writeFile(registryFile, newer);
		await expect(
			createNodeAssetRegistry({ filePath: registryFile }),
		).rejects.toMatchObject({ code: "registry_unsupported_version" });
		expect(await readFile(registryFile, "utf8")).toBe(newer);
	});
});
