import { describe, expect, it, vi } from "vitest";
import { createLocalMediaResolver } from "./localMediaResolver";

const createHandleStore = (handle: Partial<FileSystemFileHandle> | null) => ({
	get: vi.fn(async () =>
		handle
			? {
					resourceId: "resource:1",
					handle: handle as FileSystemFileHandle,
					name: "clip.webm",
					size: 1,
					lastModified: 1,
					mime: "video/webm",
					createdAt: 1,
					updatedAt: 1,
				}
			: null,
	),
	put: vi.fn(),
	delete: vi.fn(),
	diagnostics: vi.fn(),
});

describe("createLocalMediaResolver", () => {
	it("creates a fresh runtime object URL for granted file handles", async () => {
		const setResourceStatus = vi.fn();
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore({
				queryPermission: vi.fn(async () => "granted"),
				getFile: vi.fn(async () => new File(["video"], "clip.webm")),
			}),
			runtime: {
				createObjectUrl: vi.fn(() => "blob:runtime/clip"),
				revokeObjectUrl: vi.fn(),
				setResourceStatus,
			},
		});

		await expect(
			resolver.restoreResource({
				resourceId: "resource:1",
				sourceKind: "file-handle",
				sourceRef: "resource:1",
			}),
		).resolves.toBe("blob:runtime/clip");
		expect(resolver.resolveResourceUrl("resource:1", "")).toBe(
			"blob:runtime/clip",
		);
		expect(setResourceStatus).toHaveBeenCalledWith("resource:1", "ready");
	});

	it("marks resources needs-permission when read permission is not granted", async () => {
		const setResourceStatus = vi.fn();
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore({
				queryPermission: vi.fn(async () => "prompt"),
			}),
			runtime: {
				createObjectUrl: vi.fn(() => "blob:runtime/clip"),
				revokeObjectUrl: vi.fn(),
				setResourceStatus,
			},
		});

		await resolver.restoreResource({
			resourceId: "resource:1",
			sourceKind: "file-handle",
			sourceRef: "resource:1",
		});

		expect(setResourceStatus).toHaveBeenCalledWith(
			"resource:1",
			"needs-permission",
		);
	});

	it("marks resources missing when the side-channel handle is absent", async () => {
		const setResourceStatus = vi.fn();
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore(null),
			runtime: {
				createObjectUrl: vi.fn(() => "blob:runtime/clip"),
				revokeObjectUrl: vi.fn(),
				setResourceStatus,
			},
		});

		await resolver.restoreResource({
			resourceId: "resource:1",
			sourceKind: "file-handle",
			sourceRef: "resource:1",
		});

		expect(setResourceStatus).toHaveBeenCalledWith("resource:1", "missing");
	});

	it("keeps missing handle resources renderable through the fallback URL contract", async () => {
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore(null),
			runtime: {
				createObjectUrl: vi.fn(() => "blob:runtime/clip"),
				revokeObjectUrl: vi.fn(),
				setResourceStatus: vi.fn(),
			},
		});

		await resolver.restoreResource({
			resourceId: "resource:1",
			sourceKind: "file-handle",
			sourceRef: "resource:1",
		});

		expect(resolver.resolveResourceUrl("resource:1", "")).toBe("");
	});

	it("is idempotent for repeated restore calls", async () => {
		const createObjectUrl = vi.fn(() => "blob:runtime/clip");
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore({
				queryPermission: vi.fn(async () => "granted"),
				getFile: vi.fn(async () => new File(["video"], "clip.webm")),
			}),
			runtime: {
				createObjectUrl,
				revokeObjectUrl: vi.fn(),
				setResourceStatus: vi.fn(),
			},
		});
		const resource = {
			resourceId: "resource:1",
			sourceKind: "file-handle",
			sourceRef: "resource:1",
		};

		await resolver.restoreResource(resource);
		await resolver.restoreResource(resource);

		expect(createObjectUrl).toHaveBeenCalledTimes(1);
		expect(resolver.resolveResourceUrl("resource:1", "")).toBe(
			"blob:runtime/clip",
		);
	});
});
