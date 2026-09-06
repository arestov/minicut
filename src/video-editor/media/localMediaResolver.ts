import type { LocalMediaStatus } from "../domain/types";
import type { createLocalMediaHandleStore } from "./localMediaHandleStore";
import type { ProjectAssetStore } from "./projectAssetStore";

export type PermissionFileHandle = FileSystemFileHandle & {
	queryPermission?(options?: { mode?: "read" }): Promise<PermissionState>;
	requestPermission?(options?: { mode?: "read" }): Promise<PermissionState>;
};
type MediaResolverRuntime = {
	createObjectUrl(blob: Blob): string | null;
	revokeObjectUrl(url: string): void;
	setLocalMediaStatus?(resourceId: string, status: LocalMediaStatus): void;
	setResourceStatus?(resourceId: string, status: "ready" | "needs-permission" | "missing"): void;
};
export type LocalMediaResourceSnapshot = {
	resourceId: string; projectId?: unknown; assetStorageKind?: unknown;
	assetRef?: unknown; sourceKind?: unknown; sourceRef?: unknown;
};
const asPermission = (value: unknown): PermissionState | null => value === "granted" || value === "prompt" || value === "denied" ? value : null;

export const createLocalMediaResolver = ({ handleStore, projectAssets, runtime }: {
	handleStore: ReturnType<typeof createLocalMediaHandleStore>;
	projectAssets?: ProjectAssetStore;
	runtime: MediaResolverRuntime;
}) => {
	const objectUrls = new Map<string, string>();
	const inflight = new Map<string, Promise<string | null>>();
	const handles = new Map<string, PermissionFileHandle>();
	const setStatus = (resourceId: string, value: LocalMediaStatus) => {
		runtime.setLocalMediaStatus?.(resourceId, value);
		if (!runtime.setLocalMediaStatus) runtime.setResourceStatus?.(resourceId, value === "ready-project-copy" || value === "ready-file-handle" ? "ready" : value === "needs-permission" || value === "permission-denied" ? "needs-permission" : "missing");
	};
	const bind = (resourceId: string, file: File, ready: LocalMediaStatus) => {
		const url = runtime.createObjectUrl(file);
		if (!url) { setStatus(resourceId, "error"); return null; }
		const previous = objectUrls.get(resourceId);
		objectUrls.set(resourceId, url);
		if (previous && previous !== url) runtime.revokeObjectUrl(previous);
		setStatus(resourceId, ready);
		return url;
	};
	const resolveResourceUrl = (resourceId: string, fallbackUrl: string) => objectUrls.get(resourceId) ?? fallbackUrl;
	const doRestore = async (resource: LocalMediaResourceSnapshot): Promise<string | null> => {
		const resourceId = resource.resourceId;
		if (!resourceId) return null;
		setStatus(resourceId, "resolving");
		const projectId = typeof resource.projectId === "string" ? resource.projectId : null;
		if (projectAssets && projectId && (resource.assetStorageKind === "project-copy" || typeof resource.assetRef === "string")) {
			try {
				const file = await projectAssets.getFile(projectId, resourceId);
				if (file) {
					const ref = typeof resource.sourceRef === "string" && resource.sourceRef ? resource.sourceRef : resourceId;
					void handleStore.get(ref).then((record) => { if (record?.handle) handles.set(resourceId, record.handle as PermissionFileHandle); }).catch(() => undefined);
					return bind(resourceId, file, "ready-project-copy");
				}
			} catch { /* use the next backing */ }
		}
		if (resource.sourceKind !== "file-handle") { setStatus(resourceId, "missing"); return null; }
		try {
			const ref = typeof resource.sourceRef === "string" && resource.sourceRef ? resource.sourceRef : resourceId;
			const record = await handleStore.get(ref);
			if (!record?.handle) { setStatus(resourceId, "missing"); return null; }
			const handle = record.handle as PermissionFileHandle;
			handles.set(resourceId, handle);
			const state = asPermission(await handle.queryPermission?.({ mode: "read" }));
			if (state === "prompt") { setStatus(resourceId, "needs-permission"); return null; }
			if (state === "denied") { setStatus(resourceId, "permission-denied"); return null; }
			if (state !== "granted") { setStatus(resourceId, "error"); return null; }
			return bind(resourceId, await handle.getFile(), "ready-file-handle");
		} catch { setStatus(resourceId, "error"); return null; }
	};
	const restoreResource = (resource: LocalMediaResourceSnapshot): Promise<string | null> => {
		const cached = objectUrls.get(resource.resourceId);
		if (cached) return Promise.resolve(cached);
		const current = inflight.get(resource.resourceId);
		if (current) return current;
		const task = doRestore(resource).finally(() => inflight.delete(resource.resourceId));
		inflight.set(resource.resourceId, task);
		return task;
	};
	const requestResourceAccess = async (resourceId: string): Promise<string | null> => {
		const handle = handles.get(resourceId);
		if (!handle?.requestPermission) { setStatus(resourceId, "missing"); return null; }
		try {
			const state = asPermission(await handle.requestPermission({ mode: "read" }));
			if (state !== "granted") { setStatus(resourceId, "permission-denied"); return null; }
			return bind(resourceId, await handle.getFile(), "ready-file-handle");
		} catch { setStatus(resourceId, "error"); return null; }
	};
	return {
		resolveResourceUrl, restoreResource,
		restoreResources: async (resources: LocalMediaResourceSnapshot[]) => { await Promise.all(resources.map(restoreResource)); },
		requestResourceAccess,
		getCachedHandle: (resourceId: string) => handles.get(resourceId) ?? null,
		destroy() { for (const url of objectUrls.values()) runtime.revokeObjectUrl(url); objectUrls.clear(); inflight.clear(); handles.clear(); },
	};
};
