import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	runDktStorageRequest,
	type DktStorageRequest,
} from "../../dkt/storage/dktStorageRequest";
import {
	createNodeLevelDbStoragePackage,
	NodeLevelDbStorageOpenError,
} from "./createNodeLevelDbStoragePackage";

type ManifestStorage = {
	putManifest: (manifest: unknown) => void;
	getManifest: DktStorageRequest<unknown>;
};

describe("createNodeLevelDbStoragePackage", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-leveldb-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("returns the full storage package shape", async () => {
		const storagePackage = await createNodeLevelDbStoragePackage({
			storagePath: path.join(tempDir, "db"),
		});
		try {
			expect(storagePackage.dktStorage).toBeTruthy();
			expect(storagePackage.crdtStorage).toBeTruthy();
			expect(typeof storagePackage.commitChanges).toBe("function");
			expect(typeof storagePackage.whenReady).toBe("function");
			expect(typeof storagePackage.close).toBe("function");
		} finally {
			await storagePackage.close?.();
		}
	});

	it("persists committed data across close and reopen", async () => {
		const storagePath = path.join(tempDir, "db");
		const first = await createNodeLevelDbStoragePackage({ storagePath });
		(first.dktStorage as ManifestStorage).putManifest({ marker: "kept" });
		await first.commitChanges?.({ reason: "test" });
		await first.close?.();

		const second = await createNodeLevelDbStoragePackage({ storagePath });
		try {
			const manifest = await runDktStorageRequest(
				(second.dktStorage as ManifestStorage).getManifest,
			);
			expect(manifest).toMatchObject({ marker: "kept" });
		} finally {
			await second.close?.();
		}
	});

	it("fails with a diagnosable error when the database is already owned", async () => {
		const storagePath = path.join(tempDir, "db");
		const owner = await createNodeLevelDbStoragePackage({ storagePath });
		try {
			const error = await createNodeLevelDbStoragePackage({ storagePath }).then(
				() => null,
				(reason: unknown) => reason,
			);
			expect(error).toBeInstanceOf(NodeLevelDbStorageOpenError);
			expect((error as NodeLevelDbStorageOpenError).storagePath).toBe(storagePath);
		} finally {
			await owner.close?.();
		}
	});

	it("requires a storage path", async () => {
		await expect(
			createNodeLevelDbStoragePackage({ storagePath: "" }),
		).rejects.toThrow("storagePath");
	});
});
