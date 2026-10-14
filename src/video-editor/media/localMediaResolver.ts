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
	setLocalMediaAxes?(resourceId: string, state: { availability: LocalMediaAvailability; originalAccess: OriginalAccessStatus; url?: string }, snapshot?: LocalMediaResourceSnapshot): void;
};
export type LocalMediaResourceSnapshot = {
	resourceId: string; projectId?: unknown; assetStorageKind?: unknown;
	assetRef?: unknown; handleRef?: unknown; sourceKind?: unknown; sourceRef?: unknown; attemptId?: unknown; bootId?: unknown; publicationSequence?: unknown; publicationSequencePresent?: boolean;
};
type LocalMediaHandleReader = {
	get(resourceId: string): Promise<LocalMediaHandleRecord | null>;
	getByRef?(handleRef: string): Promise<LocalMediaHandleVersionRecord | null>;
};
const asPermission = (value: unknown): PermissionState | null => value === "granted" || value === "prompt" || value === "denied" ? value : null;
type LegacyLease = { snapshot: Readonly<LocalMediaResourceSnapshot> };

export const createLocalMediaResolver = ({ handleStore, projectAssets, runtime }: {
	handleStore: LocalMediaHandleReader; projectAssets?: ProjectAssetStore; runtime: MediaResolverRuntime;
}) => {
	const objectUrls = new Map<string, string>();
	const publicationOwners = new Map<string, string>();
	const inflight = new Map<string, Promise<string | null>>();
	const handles = new Map<string, PermissionFileHandle>();
	const latestSnapshots = new Map<string, LocalMediaResourceSnapshot>();
	const objectUrlOwners = new Map<string, string>();
	const leases = new Map<string, LegacyLease>();
	let disposed = false;
	const axes = new Map<string, { availability: LocalMediaAvailability; originalAccess: OriginalAccessStatus }>();
	const current = (lease: LegacyLease) => !disposed && leases.get(lease.snapshot.resourceId) === lease && !publicationOwners.has(lease.snapshot.resourceId);
	const begin = (resource: LocalMediaResourceSnapshot): LegacyLease => {
		const lease = { snapshot: Object.freeze({ ...resource }) };
		leases.set(resource.resourceId, lease);
		return lease;
	};
	const setAxes = (lease: LegacyLease, patch: Partial<{ availability: LocalMediaAvailability; originalAccess: OriginalAccessStatus }>, url?: string) => {
		if (!current(lease)) return false;
		const resourceId = lease.snapshot.resourceId;
		const next = { ...(axes.get(resourceId) ?? { availability: "unknown" as const, originalAccess: "unknown" as const }), ...patch };
		axes.set(resourceId, next);
		runtime.setLocalMediaAxes?.(resourceId, url === undefined ? next : { ...next, url }, lease.snapshot);
		return current(lease);
	};
	const setStatus = (lease: LegacyLease, value: LocalMediaStatus) => {
		if (!current(lease)) return false;
		const resourceId = lease.snapshot.resourceId;
		if (runtime.setLocalMediaStatus) runtime.setLocalMediaStatus(resourceId, value);
		else runtime.setResourceStatus?.(resourceId, value === "ready-project-copy" || value === "ready-file-handle" ? "ready" : value === "needs-permission" || value === "permission-denied" ? "needs-permission" : "missing");
		return current(lease);
	};
	const bind = (lease: LegacyLease, file: File, ready: LocalMediaStatus): string | null => {
		if (!current(lease)) return null;
		const resourceId = lease.snapshot.resourceId;
		const url = runtime.createObjectUrl(file);
		if (!current(lease)) {
			if (url && objectUrls.get(resourceId) !== url) runtime.revokeObjectUrl(url);
			return null;
		}
		if (!url) { if (setStatus(lease, "error")) setAxes(lease, { availability: "error" }); return null; }
		const previous = objectUrls.get(resourceId);
		objectUrls.set(resourceId, url);
		publicationOwners.delete(resourceId);
		if (previous && previous !== url) runtime.revokeObjectUrl(previous);
		// If revocation reentered activation, the replacing owner already revoked this URL.
		if (!current(lease)) return null;
		if (!setStatus(lease, ready)) return null;
		if (!setAxes(lease, { availability: ready }, url)) return null;
		return url;
	};
	const resolveResourceUrl = (resourceId: string, fallbackUrl: string) => objectUrls.get(resourceId) ?? fallbackUrl;
	const doRestore = async (lease: LegacyLease): Promise<string | null> => {
		const resource = lease.snapshot; const resourceId = resource.resourceId;
		if (!current(lease) || !resourceId || resource.sourceKind === "local-asset") return null;
		if (!setStatus(lease, "resolving") || !setAxes(lease, { availability: "resolving" })) return null;
		const assetParts = typeof resource.assetRef === "string" ? resource.assetRef.split("/") : [];
		const projectId = assetParts.length === 6 && assetParts[0] === "project" ? assetParts[1]
			: typeof resource.assetRef === "string" && resource.assetRef.includes("/") ? resource.assetRef.slice(0, resource.assetRef.lastIndexOf("/"))
			: typeof resource.projectId === "string" ? resource.projectId : null;
		if (projectAssets && projectId && (resource.assetStorageKind === "project-copy" || typeof resource.assetRef === "string")) {
			try {
				const file = typeof resource.assetRef === "string" && resource.assetRef.startsWith("project/") ? await projectAssets.getFileByRef(resource.assetRef) : await projectAssets.getFile(projectId, resourceId);
				if (!current(lease)) return null;
				if (file) {
					const ref = typeof resource.sourceRef === "string" && resource.sourceRef ? resource.sourceRef : resourceId;
					const record = typeof resource.handleRef === "string" && handleStore.getByRef ? await handleStore.getByRef(resource.handleRef) : await handleStore.get(ref);
					if (!current(lease)) return null;
					if (record?.handle) {
						const handle = record.handle as PermissionFileHandle;
						handles.set(resourceId, handle);
						const permission = asPermission(await handle.queryPermission?.({ mode: "read" }));
						if (!current(lease) || !setAxes(lease, { originalAccess: permission ?? "unknown" })) return null;
					} else if (!setAxes(lease, { originalAccess: "missing" })) return null;
					return bind(lease, file, "ready-project-copy");
				}
			} catch { if (!current(lease)) return null; /* use the next backing */ }
		}
		if (!current(lease)) return null;
		if (resource.sourceKind !== "file-handle") {
			if (setStatus(lease, "missing")) setAxes(lease, { availability: "unavailable", originalAccess: "missing" });
			return null;
		}
		try {
			const ref = typeof resource.sourceRef === "string" && resource.sourceRef ? resource.sourceRef : resourceId;
			const record = await handleStore.get(ref);
			if (!current(lease)) return null;
			if (!record?.handle) { if (setStatus(lease, "missing")) setAxes(lease, { availability: "unavailable", originalAccess: "missing" }); return null; }
			const handle = record.handle as PermissionFileHandle;
			handles.set(resourceId, handle);
			const state = asPermission(await handle.queryPermission?.({ mode: "read" }));
			if (!current(lease)) return null;
			if (state === "prompt") { if (setStatus(lease, "needs-permission")) setAxes(lease, { availability: "unavailable", originalAccess: "prompt" }); return null; }
			if (state === "denied") { if (setStatus(lease, "permission-denied")) setAxes(lease, { availability: "unavailable", originalAccess: "denied" }); return null; }
			if (state !== "granted") { if (setStatus(lease, "error")) setAxes(lease, { availability: "error", originalAccess: "unknown" }); return null; }
			if (!setAxes(lease, { originalAccess: "granted" })) return null;
			const handleFile = await handle.getFile();
			if (!current(lease)) return null;
			if (projectAssets && resource.assetStorageKind === "project-copy" && typeof resource.assetRef === "string") {
				const latestProjectId = resource.assetRef.slice(0, resource.assetRef.lastIndexOf("/"));
				const copy = await projectAssets.getFile(latestProjectId, resourceId);
				if (!current(lease)) return null;
				if (copy) return bind(lease, copy, "ready-project-copy");
			}
			return bind(lease, handleFile, "ready-file-handle");
		} catch { if (setStatus(lease, "error")) setAxes(lease, { availability: "error" }); return null; }
	};
	const track = (resourceId: string, lease: LegacyLease, work: Promise<string | null>) => {
		const task = work.finally(() => { if (inflight.get(resourceId) === task) inflight.delete(resourceId); });
		if (current(lease)) inflight.set(resourceId, task);
		return task;
	};
	const restoreResource = (resource: LocalMediaResourceSnapshot): Promise<string | null> => {
		const resourceId = resource.resourceId;
		if (disposed) return Promise.resolve(null);
		if (publicationOwners.has(resourceId)) return Promise.resolve(objectUrls.get(resourceId) ?? null);
		const owner = (typeof resource.bootId === "string" ? resource.bootId : "legacy") + ":" + (typeof resource.attemptId === "string" ? resource.attemptId : "legacy");
		const previousOwner = objectUrlOwners.get(resourceId);
		const sameOwner = !previousOwner || previousOwner === owner;
		const pending = sameOwner ? inflight.get(resourceId) : undefined;
		if (pending && resource.assetStorageKind !== "project-copy") return pending;
		const lease = begin(resource);
		if (!sameOwner) {
			const previousUrl = objectUrls.get(resourceId);
			objectUrls.delete(resourceId); inflight.delete(resourceId);
			if (previousUrl) runtime.revokeObjectUrl(previousUrl);
			if (!current(lease)) return Promise.resolve(null);
		}
		objectUrlOwners.set(resourceId, owner);
		latestSnapshots.set(resourceId, lease.snapshot);
		const cached = objectUrls.get(resourceId);
		if (cached) {
			return Promise.resolve(setStatus(lease, resource.assetStorageKind === "project-copy" ? "ready-project-copy" : "ready-file-handle") ? cached : null);
		}
		return track(resourceId, lease, pending ? pending.then(() => doRestore(lease)) : doRestore(lease));
	};
	const requestResourceAccess = async (resourceId: string): Promise<string | null> => {
		if (disposed) return null;
		if (publicationOwners.has(resourceId)) return objectUrls.get(resourceId) ?? null;
		const lease = begin(latestSnapshots.get(resourceId) ?? { resourceId });
		const handle = handles.get(resourceId);
		if (!handle?.requestPermission) { if (setStatus(lease, "missing")) setAxes(lease, { originalAccess: "missing" }); return null; }
		try {
			const state = asPermission(await handle.requestPermission({ mode: "read" }));
			if (!current(lease)) return null;
			if (state !== "granted") { if (setStatus(lease, "permission-denied")) setAxes(lease, { originalAccess: state === "prompt" ? "prompt" : "denied" }); return null; }
			if (!setAxes(lease, { originalAccess: "granted" })) return null;
			const file = await handle.getFile();
			if (!current(lease)) return null;
			if (axes.get(resourceId)?.availability === "ready-project-copy") return objectUrls.get(resourceId) ?? null;
			return bind(lease, file, "ready-file-handle");
		} catch { if (setStatus(lease, "error")) setAxes(lease, { originalAccess: "unknown" }); return null; }
	};
	return {
		resolveResourceUrl, restoreResource,
		activateObjectUrl(resourceId: string, url: string, ready: LocalMediaStatus = "ready-project-copy", publicationIdentity?: string) {
			if (disposed) return;
			leases.delete(resourceId); inflight.delete(resourceId);
			const previous = objectUrls.get(resourceId);
			objectUrls.set(resourceId, url);
			if (publicationIdentity) publicationOwners.set(resourceId, publicationIdentity); else publicationOwners.delete(resourceId);
			if (previous && previous !== url) runtime.revokeObjectUrl(previous);
			if (!disposed && !publicationIdentity && objectUrls.get(resourceId) === url && !publicationOwners.has(resourceId)) {
				if (runtime.setLocalMediaStatus) runtime.setLocalMediaStatus(resourceId, ready);
				else runtime.setResourceStatus?.(resourceId, ready === "ready-project-copy" || ready === "ready-file-handle" ? "ready" : ready === "needs-permission" || ready === "permission-denied" ? "needs-permission" : "missing");
			}
		},
		releasePublicationUrl(resourceId: string, publicationIdentity: string) {
			if (disposed || publicationOwners.get(resourceId) !== publicationIdentity) return;
			const url = objectUrls.get(resourceId); objectUrls.delete(resourceId); publicationOwners.delete(resourceId);
			if (url) runtime.revokeObjectUrl(url);
		},
		restoreResources: async (resources: LocalMediaResourceSnapshot[]) => { await Promise.all(resources.map(restoreResource)); },
		requestResourceAccess,
		getCachedHandle: (resourceId: string) => handles.get(resourceId) ?? null,
		getState: (resourceId: string) => axes.get(resourceId) ?? { availability: "unknown" as const, originalAccess: "unknown" as const },
		destroy() {
			if (disposed) return;
			disposed = true;
			const urls = [...objectUrls.values()];
			objectUrls.clear(); publicationOwners.clear(); objectUrlOwners.clear(); inflight.clear(); leases.clear(); handles.clear(); latestSnapshots.clear(); axes.clear();
			for (const url of urls) runtime.revokeObjectUrl(url);
		},
	};
};
