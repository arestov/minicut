import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
	LOCAL_MEDIA_HANDLE_DB_NAME,
	createLocalMediaHandleStore,
} from "./localMediaHandleStore";

const makeHandle = (name = "clip.webm") =>
	({
		kind: "file",
		name,
	}) as FileSystemFileHandle;

const putLegacyRecord = async (record: Record<string, unknown>): Promise<void> => {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(LOCAL_MEDIA_HANDLE_DB_NAME, 1);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction("handles", "readwrite");
			transaction.objectStore("handles").put(record);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
};

describe("local media handle side-channel store", () => {
	it("stores and reads FileSystemFileHandle records by resource id", async () => {
		const store = createLocalMediaHandleStore(indexedDB);
		const now = Date.now();

		await store.put({
			resourceId: "resource:1",
			handle: makeHandle(),
			name: "clip.webm",
			size: 123,
			lastModified: 1_780_000_000,
			mime: "video/webm",
			createdAt: now,
			updatedAt: now,
		});

		const record = await store.get("resource:1");

		expect(record?.resourceId).toBe("resource:1");
		expect(record?.name).toBe("clip.webm");
		expect(record?.handle.name).toBe("clip.webm");
	});

	it("forbids Blob, ArrayBuffer, and typed array payloads outside the handle", async () => {
		const store = createLocalMediaHandleStore(indexedDB);
		const base = {
			resourceId: "resource:bytes",
			handle: makeHandle("bytes.webm"),
			name: "bytes.webm",
			size: 4,
			lastModified: null,
			mime: "video/webm",
			createdAt: 1,
			updatedAt: 1,
		};

		await expect(
			store.put({ ...base, blob: new Blob(["bytes"]) } as never),
		).rejects.toThrow(/must not persist media bytes/i);
		await expect(
			store.put({ ...base, buffer: new ArrayBuffer(4) } as never),
		).rejects.toThrow(/must not persist media bytes/i);
		await expect(
			store.put({ ...base, bytes: new Uint8Array([1, 2, 3]) } as never),
		).rejects.toThrow(/must not persist media bytes/i);
	});

	it("normalizes legacy records with missing or null file metadata", async () => {
		await putLegacyRecord({
			resourceId: "resource:legacy",
			handle: makeHandle("legacy.webm"),
			name: "legacy.webm",
			mime: "video/webm",
			createdAt: 1,
			updatedAt: 2,
		});

		const record = await createLocalMediaHandleStore(indexedDB).get(
			"resource:legacy",
		);

		expect(record).toMatchObject({
			resourceId: "resource:legacy",
			size: null,
			lastModified: null,
		});
	});

	it("exposes diagnostics without reading handle payloads", async () => {
		const store = createLocalMediaHandleStore(indexedDB);
		const diagnostics = await store.diagnostics();

		expect(diagnostics.dbName).toBe(LOCAL_MEDIA_HANDLE_DB_NAME);
		expect(diagnostics.storeName).toBe("handles");
		expect(diagnostics.handleCount).toBeGreaterThanOrEqual(1);
	});
});
