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
		const request = indexedDB.open(LOCAL_MEDIA_HANDLE_DB_NAME);
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

	it("stages immutable handle versions and removes only unpublished versions", async () => {
		const store = createLocalMediaHandleStore(indexedDB);
		const base = { resourceId: "resource:versioned", handle: makeHandle(), name: "clip.webm", size: 1, lastModified: 2, mime: "video/webm", createdAt: 1, updatedAt: 1 };
		const oldRef = await store.stage("project:1", base.resourceId, "old", base);
		const nextRef = await store.stage("project:1", base.resourceId, "next", { ...base, updatedAt: 2 });
		expect(await store.validate(nextRef)).toBe(true);
		expect(await store.reconcile(base.resourceId, oldRef)).toEqual({ kept: [oldRef], removed: [nextRef] });
		expect(await store.getByRef(nextRef)).toBeNull();
		expect(await store.getByRef(oldRef)).not.toBeNull();
	});

	it("migrates a legacy resource key idempotently to a version ref", async () => {
		const store = createLocalMediaHandleStore(indexedDB);
		const record = { resourceId: "resource:migrate", handle: makeHandle(), name: "clip.webm", size: null, lastModified: null, mime: "video/webm", createdAt: 1, updatedAt: 1 };
		await store.put(record);
		const ref = await store.migrateLegacy("project:1", record.resourceId, "migration");
		expect(ref).toBe("project/project:1/resource/resource:migrate/handle/migration");
		expect(ref && await store.validate(ref)).toBe(true);
	});
});

describe("owned handle reconciliation", () => {
	it("S4 keeps the exact newly staged handle despite a stale published ref", async () => {
		const store = createLocalMediaHandleStore(indexedDB);
		const base = { resourceId: "r-protected", handle: makeHandle("protected.webm"), name: "protected.webm", size: 4, lastModified: 1, mime: "video/webm", createdAt: 1, updatedAt: 1 };
		const old = await store.stage("p-protected", "r-protected", "old", base);
		const fresh = await store.stage("p-protected", "r-protected", "new", base);
		store.protectPublicationResource("r-protected");
		await store.reconcile("r-protected", old);
		expect((await store.getByRef(fresh))?.handle.name).toBe("protected.webm");
		await store.rollback(old);
		expect(await store.getByRef(old)).toBeNull();
		expect((await store.getByRef(fresh))?.handle.name).toBe("protected.webm");
	});
});
describe("handle deletion boundary cancellation", () => {
	it("S4 rechecks new ownership after the stale loop entered an asynchronous DB open", async () => {
		let armed = false; let openings = 0;
		const factory = { open(...args: Parameters<typeof indexedDB.open>) {
			if (armed && ++openings === 2) store.protectPublicationResource("r-boundary");
			return indexedDB.open(...args);
		} };
		const store = createLocalMediaHandleStore(factory);
		const record = { resourceId: "r-boundary", handle: makeHandle("boundary.webm"), name: "boundary.webm", size: 1, lastModified: 1, mime: "video/webm", createdAt: 1, updatedAt: 1 };
		const fresh = await store.stage("p-boundary", "r-boundary", "new-boundary", record);
		armed = true;
		expect((await store.reconcile("r-boundary", null)).removed).toEqual([]);
		expect((await store.getByRef(fresh))?.name).toBe("boundary.webm");
	});
});
