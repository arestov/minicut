import { describe, expect, it, vi } from "vitest";
import { createLocalMediaResolver, type PermissionFileHandle } from "./localMediaResolver";

const createHandleStore = (handle: Partial<PermissionFileHandle> | null) => ({
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
				queryPermission: vi.fn(async () => "granted" as PermissionState),
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
				queryPermission: vi.fn(async () => "prompt" as PermissionState),
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
				queryPermission: vi.fn(async () => "granted" as PermissionState),
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

	it("prefers a project copy even when the original handle is denied", async () => {
		const setLocalMediaStatus = vi.fn();
		const setLocalMediaAxes = vi.fn();
		const queryPermission = vi.fn(async () => "denied" as PermissionState);
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore({ queryPermission }),
			projectAssets: { getFile: vi.fn(async () => new File(["copy"], "clip.webm")) } as never,
			runtime: { createObjectUrl: () => "blob:project-copy", revokeObjectUrl: vi.fn(), setLocalMediaStatus, setLocalMediaAxes },
		});
		await expect(resolver.restoreResource({ resourceId: "resource:1", projectId: "project:1", assetStorageKind: "project-copy", assetRef: "project:1/resource:1", sourceKind: "file-handle" })).resolves.toBe("blob:project-copy");
		expect(setLocalMediaStatus).toHaveBeenLastCalledWith("resource:1", "ready-project-copy");
		expect(queryPermission).toHaveBeenCalledOnce();
		expect(setLocalMediaAxes).toHaveBeenLastCalledWith("resource:1", { availability: "ready-project-copy", originalAccess: "denied" });
		expect(resolver.getState("resource:1")).toEqual({ availability: "ready-project-copy", originalAccess: "denied" });
	});

	it("keeps availability unavailable while original access is prompt", async () => {
		const resolver = createLocalMediaResolver({ handleStore: createHandleStore({ queryPermission: vi.fn(async () => "prompt" as PermissionState) }), runtime: { createObjectUrl: vi.fn(() => null), revokeObjectUrl: vi.fn() } });
		await resolver.restoreResource({ resourceId: "resource:1", sourceKind: "file-handle" });
		expect(resolver.getState("resource:1")).toEqual({ availability: "unavailable", originalAccess: "prompt" });
	});

	it("keeps a project copy ready while original access is prompt and after a later grant", async () => {
		let permission: PermissionState = "prompt";
		const handle = { queryPermission: vi.fn(async () => permission), requestPermission: vi.fn(async () => { permission = "granted"; return permission; }), getFile: vi.fn(async () => new File(["original"], "clip.webm")) };
		const resolver = createLocalMediaResolver({ handleStore: createHandleStore(handle), projectAssets: { getFile: vi.fn(async () => new File(["copy"], "clip.webm")) } as never, runtime: { createObjectUrl: vi.fn(() => "blob:copy"), revokeObjectUrl: vi.fn() } });
		await resolver.restoreResource({ resourceId: "resource:1", projectId: "project:1", assetStorageKind: "project-copy" });
		expect(resolver.getState("resource:1")).toEqual({ availability: "ready-project-copy", originalAccess: "prompt" });
		await resolver.requestResourceAccess("resource:1");
		expect(resolver.getState("resource:1")).toEqual({ availability: "ready-project-copy", originalAccess: "granted" });
		expect(resolver.resolveResourceUrl("resource:1", "")).toBe("blob:copy");
	});

	it("revokes only the superseded attempt URL and creates a fresh URL", async () => {
		const revokeObjectUrl = vi.fn(); let serial = 0;
		const resolver = createLocalMediaResolver({ handleStore: createHandleStore({ queryPermission: vi.fn(async () => "granted" as PermissionState), getFile: vi.fn(async () => new File(["x"], "x")) }), runtime: { createObjectUrl: vi.fn(() => `blob:${++serial}`), revokeObjectUrl } });
		await resolver.restoreResource({ resourceId: "resource:1", sourceKind: "file-handle", bootId: "boot:1", attemptId: "attempt:1" });
		await resolver.restoreResource({ resourceId: "resource:1", sourceKind: "file-handle", bootId: "boot:1", attemptId: "attempt:2" });
		expect(revokeObjectUrl).toHaveBeenCalledOnce(); expect(revokeObjectUrl).toHaveBeenCalledWith("blob:1"); expect(resolver.resolveResourceUrl("resource:1", "")).toBe("blob:2");
	});

	it("distinguishes denied and retries permission on the cached handle", async () => {
		const setLocalMediaStatus = vi.fn();
		const requestPermission = vi.fn(async () => "granted" as PermissionState);
		const handle = {
			queryPermission: vi.fn(async () => "denied" as PermissionState),
			requestPermission,
			getFile: vi.fn(async () => new File(["video"], "clip.webm")),
		};
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore(handle),
			runtime: { createObjectUrl: () => "blob:granted", revokeObjectUrl: vi.fn(), setLocalMediaStatus },
		});
		await resolver.restoreResource({ resourceId: "resource:1", sourceKind: "file-handle" });
		expect(setLocalMediaStatus).toHaveBeenLastCalledWith("resource:1", "permission-denied");
		await expect(resolver.requestResourceAccess("resource:1")).resolves.toBe("blob:granted");
		expect(requestPermission).toHaveBeenCalledOnce();
		expect(setLocalMediaStatus).toHaveBeenLastCalledWith("resource:1", "ready-file-handle");
	});
});
