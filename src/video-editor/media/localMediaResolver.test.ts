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
	it("leaves local-asset resources untouched during restore", async () => {
		const setResourceStatus = vi.fn();
		const handleStore = createHandleStore(null);
		const resolver = createLocalMediaResolver({
			handleStore,
			runtime: {
				createObjectUrl: vi.fn(() => "blob:runtime/unused"),
				revokeObjectUrl: vi.fn(),
				setResourceStatus,
			},
		});

		await expect(
			resolver.restoreResource({
				resourceId: "resource:asset",
				sourceKind: "local-asset",
				sourceRef: "asset:registry-1",
			}),
		).resolves.toBeNull();
		expect(setResourceStatus).not.toHaveBeenCalled();
		expect(handleStore.get).not.toHaveBeenCalled();
	});

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
		expect(setLocalMediaAxes).toHaveBeenLastCalledWith("resource:1", { availability: "ready-project-copy", originalAccess: "denied" }, expect.objectContaining({ resourceId: "resource:1", assetRef: "project:1/resource:1" }));
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

describe("publication playback ownership", () => {
	it("L3 exact release of A does not revoke or replace B and legacy binding loses the publication token", () => {
		const revoked: string[] = []; const status = vi.fn();
		const resolver = createLocalMediaResolver({ handleStore: createHandleStore(null), runtime: { createObjectUrl: () => "unused", revokeObjectUrl: (url) => revoked.push(url), setResourceStatus: status } });
		resolver.activateObjectUrl("resource", "blob:playback:A", "ready-project-copy", "A");
		resolver.activateObjectUrl("resource", "blob:playback:B", "ready-project-copy", "B");
		resolver.releasePublicationUrl("resource", "A");
		expect(resolver.resolveResourceUrl("resource", "")).toBe("blob:playback:B");
		expect(revoked).toEqual(["blob:playback:A"]);
		expect(status).not.toHaveBeenCalled();
		resolver.activateObjectUrl("resource", "blob:legacy", "ready-project-copy");
		resolver.releasePublicationUrl("resource", "B");
		expect(resolver.resolveResourceUrl("resource", "")).toBe("blob:legacy");
		resolver.destroy(); expect(revoked.filter((url) => url === "blob:legacy")).toHaveLength(1);
	});
});

describe("internal late restore publication control", () => {
	it("does not let an old project restore replace a newer publication while permission is pending", async () => {
		let enterPermission!: () => void;
		let settlePermission!: (permission: PermissionState) => void;
		const permissionEntered = new Promise<void>((resolve) => { enterPermission = resolve; });
		const permission = new Promise<PermissionState>((resolve) => { settlePermission = resolve; });
		const projectFile = new File(["old project bytes"], "old.webm", { type: "video/webm" });
		const loadedFiles: File[] = [];
		const revoked: string[] = [];
		const statuses: unknown[] = [];
		const axes: unknown[] = [];
		const publicationUrl = "blob:publication:B";
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore({ queryPermission: () => { enterPermission(); return permission; } }),
			projectAssets: { getFile: async () => { loadedFiles.push(projectFile); return projectFile; } } as never,
			runtime: {
				createObjectUrl: () => "blob:restore:A",
				revokeObjectUrl: (url) => { revoked.push(url); },
				setLocalMediaStatus: (resourceId, status) => { statuses.push({ resourceId, status }); },
				setLocalMediaAxes: (resourceId, state) => { axes.push({ resourceId, ...state }); },
			},
		});
		try {
			const oldRestore = resolver.restoreResource({
				resourceId: "resource:1", projectId: "project:1", assetStorageKind: "project-copy",
				assetRef: "project:1/resource:1", sourceKind: "file-handle", sourceRef: "resource:1",
				bootId: "boot:A", attemptId: "attempt:A",
			});
			await permissionEntered;
			expect(loadedFiles).toEqual([projectFile]);
			resolver.activateObjectUrl("resource:1", publicationUrl, "ready-project-copy", "publication:B");
			expect(resolver.resolveResourceUrl("resource:1", "")).toBe(publicationUrl);
			const statusCountAfterB = statuses.length;
			const axesCountAfterB = axes.length;
			settlePermission("denied");
			await oldRestore;
			expect(resolver.resolveResourceUrl("resource:1", "")).toBe(publicationUrl);
			expect(revoked).not.toContain(publicationUrl);
			expect(statuses).toHaveLength(statusCountAfterB);
			expect(axes).toHaveLength(axesCountAfterB);
		} finally {
			resolver.destroy();
		}
	});
});

describe("internal resolver continuation fences", () => {
	it.each(["status", "axes", "create", "revoke"] as const)("keeps B through reentrant %s activation", async (boundary) => {
		let resolver!: ReturnType<typeof createLocalMediaResolver>;
		let enabled = false; let entered = false;
		const revoked: string[] = []; const afterB: string[] = [];
		const activate = (at: string) => {
			if (!entered && enabled && at === boundary) {
				entered = true;
				resolver.activateObjectUrl("resource:1", "blob:B", "ready-project-copy", "B");
			} else if (entered && at !== "revoke") afterB.push(at);
		};
		resolver = createLocalMediaResolver({
			handleStore: createHandleStore(null),
			projectAssets: { getFile: async () => new File(["A"], "A.webm") } as never,
			runtime: {
				createObjectUrl: () => { activate("create"); return "blob:A"; },
				revokeObjectUrl: (url) => { revoked.push(url); activate("revoke"); },
				setLocalMediaStatus: () => { activate("status"); },
				setLocalMediaAxes: () => { activate("axes"); },
			},
		});
		const snapshot = { resourceId: "resource:1", projectId: "project:1", assetStorageKind: "project-copy", bootId: "boot", attemptId: "old" };
		if (boundary === "revoke") {
			resolver.activateObjectUrl("resource:1", "blob:previous");
			await resolver.restoreResource(snapshot);
		}
		enabled = true;
		await resolver.restoreResource({ ...snapshot, attemptId: "new" });
		expect(entered).toBe(true);
		expect(resolver.resolveResourceUrl("resource:1", "")).toBe("blob:B");
		expect(revoked).not.toContain("blob:B");
		expect(afterB).toEqual([]);
		if (boundary === "create") expect(revoked).toEqual(["blob:A"]);
		resolver.destroy();
	});

	it.each(["rejection", "disposal"] as const)("ignores a late permission %s and nested teardown activation", async (mode) => {
		let entered!: () => void; let settle!: () => void;
		const boundary = new Promise<void>((resolve) => { entered = resolve; });
		const permission = new Promise<PermissionState>((resolve, reject) => { settle = mode === "rejection" ? () => reject(new Error("late permission")) : () => resolve("denied"); });
		const statuses: unknown[] = []; const axes: unknown[] = []; const revoked: string[] = [];
		let resolver!: ReturnType<typeof createLocalMediaResolver>;
		resolver = createLocalMediaResolver({
			handleStore: createHandleStore({ queryPermission: () => { entered(); return permission; } }),
			projectAssets: { getFile: async () => new File(["A"], "A.webm") } as never,
			runtime: {
				createObjectUrl: () => "blob:A",
				revokeObjectUrl: (url) => { revoked.push(url); if (mode === "disposal") resolver.activateObjectUrl("resource:1", "blob:nested", "ready-project-copy", "nested"); },
				setLocalMediaStatus: (_id, status) => { statuses.push(status); },
				setLocalMediaAxes: (_id, state) => { axes.push(state); },
			},
		});
		const work = resolver.restoreResource({ resourceId: "resource:1", projectId: "project:1", assetStorageKind: "project-copy" });
		await boundary;
		resolver.activateObjectUrl("resource:1", "blob:B", "ready-project-copy", "B");
		if (mode === "disposal") resolver.destroy();
		const statusCount = statuses.length; const axesCount = axes.length;
		settle(); await work;
		expect(resolver.resolveResourceUrl("resource:1", "")).toBe(mode === "disposal" ? "" : "blob:B");
		expect(statuses).toHaveLength(statusCount); expect(axes).toHaveLength(axesCount);
		expect(revoked).toEqual(mode === "disposal" ? ["blob:B"] : []);
		if (mode === "disposal") {
			expect(await resolver.restoreResource({ resourceId: "resource:1" })).toBeNull();
			expect(await resolver.requestResourceAccess("resource:1")).toBeNull();
		} else {
			expect(await resolver.restoreResource({ resourceId: "resource:1", bootId: "different" })).toBe("blob:B");
			expect(await resolver.requestResourceAccess("resource:1")).toBe("blob:B");
			expect(statuses).toHaveLength(statusCount); expect(axes).toHaveLength(axesCount);
			resolver.destroy();
		}
	});

	it("coalesces promoted work after the older inflight finally and carries the original snapshot", async () => {
		let releaseOld!: (file: File) => void; let enteredOld!: () => void;
		let releaseCopy!: (file: File) => void; let enteredCopy!: () => void;
		const oldBoundary = new Promise<void>((resolve) => { enteredOld = resolve; });
		const copyBoundary = new Promise<void>((resolve) => { enteredCopy = resolve; });
		const oldFile = new Promise<File>((resolve) => { releaseOld = resolve; });
		const copyFile = new Promise<File>((resolve) => { releaseCopy = resolve; });
		const snapshots: unknown[] = [];
		const resolver = createLocalMediaResolver({
			handleStore: createHandleStore({ queryPermission: async () => "granted", getFile: () => { enteredOld(); return oldFile; } }),
			projectAssets: { getFile: () => { enteredCopy(); return copyFile; } } as never,
			runtime: { createObjectUrl: (file) => "blob:" + (file as File).name, revokeObjectUrl: () => {}, setLocalMediaAxes: (_id, _state, snapshot) => { snapshots.push(snapshot); } },
		});
		const original = { resourceId: "resource:1", sourceKind: "file-handle", sourceRef: "resource:1", bootId: "boot", attemptId: "attempt", publicationSequence: 0 };
		const old = resolver.restoreResource(original);
		await oldBoundary;
		const copySnapshot = { ...original, projectId: "project:1", assetStorageKind: "project-copy", assetRef: "project:1/resource:1" };
		const promoted = resolver.restoreResource(copySnapshot);
		copySnapshot.assetRef = "later-mutated-ref";
		releaseOld(new File(["old"], "old")); await old;
		await copyBoundary;
		expect(resolver.restoreResource(original)).toBe(promoted);
		releaseCopy(new File(["copy"], "copy")); await promoted;
		expect(resolver.resolveResourceUrl("resource:1", "")).toBe("blob:copy");
		expect(snapshots.at(-1)).toEqual({ ...copySnapshot, assetRef: "project:1/resource:1" });
		resolver.destroy();
	});
});
