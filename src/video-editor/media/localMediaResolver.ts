import type { LocalMediaAvailability, LocalMediaStatus, OriginalAccessStatus } from "../domain/types";
import type { LocalMediaHandleRecord, LocalMediaHandleVersionRecord } from "./localMediaHandleStore";
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
	setLocalMediaAxes?(resourceId: string, state: { availability: LocalMediaAvailability; originalAccess: OriginalAccessStatus }): void;
};
export type LocalMediaResourceSnapshot = {
	resourceId: string; projectId?: unknown; assetStorageKind?: unknown;
	assetRef?: unknown; handleRef?: unknown; sourceKind?: unknown; sourceRef?: unknown; attemptId?: unknown; bootId?: unknown;
};
type LocalMediaHandleReader = {
	get(resourceId: string): Promise<LocalMediaHandleRecord | null>;
	getByRef?(handleRef: string): Promise<LocalMediaHandleVersionRecord | null>;
};
const asPermission = (value: unknown): PermissionState | null => value === "granted" || value === "prompt" || value === "denied" ? value : null;

export const createLocalMediaResolver = ({ handleStore, projectAssets, runtime }: {
	handleStore: LocalMediaHandleReader;
	projectAssets?: ProjectAssetStore;
	runtime: MediaResolverRuntime;
}) => {
	const objectUrls = new Map<string, string>();
	const inflight = new Map<string, Promise<string | null>>();
	const handles = new Map<string, PermissionFileHandle>();
	const latestSnapshots = new Map<string, LocalMediaResourceSnapshot>();
	const objectUrlOwners = new Map<string, string>();
	const axes = new Map<string, { availability: LocalMediaAvailability; originalAccess: OriginalAccessStatus }>();
	const setAxes = (resourceId: string, patch: Partial<{ availability: LocalMediaAvailability; originalAccess: OriginalAccessStatus }>) => {
		const next = { ...(axes.get(resourceId) ?? { availability: "unknown" as const, originalAccess: "unknown" as const }), ...patch };
		axes.set(resourceId, next); runtime.setLocalMediaAxes?.(resourceId, next);
	};
	const setStatus = (resourceId: string, value: LocalMediaStatus) => {
		runtime.setLocalMediaStatus?.(resourceId, value);
		if (!runtime.setLocalMediaStatus) runtime.setResourceStatus?.(resourceId, value === "ready-project-copy" || value === "ready-file-handle" ? "ready" : value === "needs-permission" || value === "permission-denied" ? "needs-permission" : "missing");
	};
	const bind = (resourceId: string, file: File, ready: LocalMediaStatus) => {
		const url = runtime.createObjectUrl(file);
		if (!url) { setStatus(resourceId, "error"); setAxes(resourceId, { availability: "error" }); return null; }
		const previous = objectUrls.get(resourceId);
		objectUrls.set(resourceId, url);
		if (previous && previous !== url) runtime.revokeObjectUrl(previous);
		setStatus(resourceId, ready);
		setAxes(resourceId, { availability: ready });
		return url;
	};
	const resolveResourceUrl = (resourceId: string, fallbackUrl: string) => objectUrls.get(resourceId) ?? fallbackUrl;
	const doRestore = async (resource: LocalMediaResourceSnapshot): Promise<string | null> => {
		const resourceId = resource.resourceId;
		if (!resourceId) return null;
		// Host asset-registry resources are resolved by the host, not by the web recovery path.
		if (resource.sourceKind === "local-asset") return null;
		setStatus(resourceId, "resolving"); setAxes(resourceId, { availability: "resolving" });
		const assetParts = typeof resource.assetRef === "string" ? resource.assetRef.split("/") : [];
		const projectId = assetParts.length === 6 && assetParts[0] === "project"
			? assetParts[1]
			: typeof resource.assetRef === "string" && resource.assetRef.includes("/") ? resource.assetRef.slice(0, resource.assetRef.lastIndexOf("/"))
			: typeof resource.projectId === "string" ? resource.projectId : null;
		if (projectAssets && projectId && (resource.assetStorageKind === "project-copy" || typeof resource.assetRef === "string")) {
			try {
				const file = typeof resource.assetRef === "string" && resource.assetRef.startsWith("project/") ? await projectAssets.getFileByRef(resource.assetRef) : await projectAssets.getFile(projectId, resourceId);
				if (file) {
					const ref = typeof resource.sourceRef === "string" && resource.sourceRef ? resource.sourceRef : resourceId;
					const record = typeof resource.handleRef === "string" && handleStore.getByRef ? await handleStore.getByRef(resource.handleRef) : await handleStore.get(ref);
					if (record?.handle) {
						const handle = record.handle as PermissionFileHandle; handles.set(resourceId, handle);
						const permission = asPermission(await handle.queryPermission?.({ mode: "read" })); setAxes(resourceId, { originalAccess: permission ?? "unknown" });
					} else setAxes(resourceId, { originalAccess: "missing" });
					return bind(resourceId, file, "ready-project-copy");
				}
			} catch { /* use the next backing */ }
		}
		if (resource.sourceKind !== "file-handle") { setStatus(resourceId, "missing"); setAxes(resourceId, { availability: "unavailable", originalAccess: "missing" }); return null; }
		try {
			const ref = typeof resource.sourceRef === "string" && resource.sourceRef ? resource.sourceRef : resourceId;
			const record = await handleStore.get(ref);
			if (!record?.handle) { setStatus(resourceId, "missing"); setAxes(resourceId, { availability: "unavailable", originalAccess: "missing" }); return null; }
			const handle = record.handle as PermissionFileHandle;
			handles.set(resourceId, handle);
			const state = asPermission(await handle.queryPermission?.({ mode: "read" }));
			if (state === "prompt") { setStatus(resourceId, "needs-permission"); setAxes(resourceId, { availability: "unavailable", originalAccess: "prompt" }); return null; }
			if (state === "denied") { setStatus(resourceId, "permission-denied"); setAxes(resourceId, { availability: "unavailable", originalAccess: "denied" }); return null; }
			if (state !== "granted") { setStatus(resourceId, "error"); setAxes(resourceId, { availability: "error", originalAccess: "unknown" }); return null; }
			setAxes(resourceId, { originalAccess: "granted" });
			const handleFile = await handle.getFile();
			const latest = latestSnapshots.get(resourceId);
			if (projectAssets && latest?.assetStorageKind === "project-copy" && typeof latest.assetRef === "string") {
				const latestProjectId = latest.assetRef.slice(0, latest.assetRef.lastIndexOf("/"));
				const copy = await projectAssets.getFile(latestProjectId, resourceId);
				if (copy) return bind(resourceId, copy, "ready-project-copy");
			}
			return bind(resourceId, handleFile, "ready-file-handle");
		} catch { setStatus(resourceId, "error"); setAxes(resourceId, { availability: "error" }); return null; }
	};
	const restoreResource = (resource: LocalMediaResourceSnapshot): Promise<string | null> => {
		const owner = `${typeof resource.bootId === "string" ? resource.bootId : "legacy"}:${typeof resource.attemptId === "string" ? resource.attemptId : "legacy"}`;
		const previousOwner = objectUrlOwners.get(resource.resourceId);
		if (previousOwner && previousOwner !== owner) {
			const previousUrl = objectUrls.get(resource.resourceId); if (previousUrl) runtime.revokeObjectUrl(previousUrl);
			objectUrls.delete(resource.resourceId); inflight.delete(resource.resourceId);
		}
		objectUrlOwners.set(resource.resourceId, owner);
		latestSnapshots.set(resource.resourceId, resource);
		const cached = objectUrls.get(resource.resourceId);
		if (cached) {
			setStatus(resource.resourceId, resource.assetStorageKind === "project-copy" ? "ready-project-copy" : "ready-file-handle");
			return Promise.resolve(cached);
		}
		const current = inflight.get(resource.resourceId);
		if (current) {
			if (resource.assetStorageKind !== "project-copy") return current;
			const promoted = current.then(() => doRestore(resource)).finally(() => inflight.delete(resource.resourceId));
			inflight.set(resource.resourceId, promoted);
			return promoted;
		}
		const task = doRestore(resource).finally(() => inflight.delete(resource.resourceId));
		inflight.set(resource.resourceId, task);
		return task;
	};
	const requestResourceAccess = async (resourceId: string): Promise<string | null> => {
		const handle = handles.get(resourceId);
		if (!handle?.requestPermission) { setStatus(resourceId, "missing"); setAxes(resourceId, { originalAccess: "missing" }); return null; }
		try {
			const state = asPermission(await handle.requestPermission({ mode: "read" }));
			if (state !== "granted") { setStatus(resourceId, "permission-denied"); setAxes(resourceId, { originalAccess: state === "prompt" ? "prompt" : "denied" }); return null; }
			setAxes(resourceId, { originalAccess: "granted" });
			const file = await handle.getFile();
			if (axes.get(resourceId)?.availability === "ready-project-copy") return objectUrls.get(resourceId) ?? null;
			return bind(resourceId, file, "ready-file-handle");
		} catch { setStatus(resourceId, "error"); setAxes(resourceId, { originalAccess: "unknown" }); return null; }
	};
	return {
		resolveResourceUrl, restoreResource,
		activateObjectUrl(resourceId: string, url: string, ready: LocalMediaStatus = "ready-project-copy") {
			const previous = objectUrls.get(resourceId);
			objectUrls.set(resourceId, url);
			if (previous && previous !== url) runtime.revokeObjectUrl(previous);
			setStatus(resourceId, ready);
		},
		restoreResources: async (resources: LocalMediaResourceSnapshot[]) => { await Promise.all(resources.map(restoreResource)); },
		requestResourceAccess,
		getCachedHandle: (resourceId: string) => handles.get(resourceId) ?? null,
		getState: (resourceId: string) => axes.get(resourceId) ?? { availability: "unknown" as const, originalAccess: "unknown" as const },
		destroy() { for (const url of objectUrls.values()) runtime.revokeObjectUrl(url); objectUrls.clear(); objectUrlOwners.clear(); inflight.clear(); handles.clear(); latestSnapshots.clear(); axes.clear(); },
	};
};
