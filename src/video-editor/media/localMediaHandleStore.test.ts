import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createLocalMediaHandleStore } from "./localMediaHandleStore";

const makeHandle = (name = "clip.webm") =>
	({
		kind: "file",
		name,
	}) as FileSystemFileHandle;

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
});
