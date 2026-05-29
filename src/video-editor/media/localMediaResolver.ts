import type { createLocalMediaHandleStore } from "./localMediaHandleStore";

type MediaResolverRuntime = {
	createObjectUrl(blob: Blob): string | null;
	revokeObjectUrl(url: string): void;
	setResourceStatus(resourceId: string, status: "ready" | "needs-permission" | "missing"): void;
};

export type LocalMediaResourceSnapshot = {
	resourceId: string;
	sourceKind?: unknown;
	sourceRef?: unknown;
	status?: unknown;
	url?: unknown;
};

const asHandlePermission = (value: unknown): PermissionState | null =>
	value === "granted" || value === "prompt" || value === "denied" ? value : null;

export const createLocalMediaResolver = ({
	handleStore,
	runtime,
}: {
	handleStore: ReturnType<typeof createLocalMediaHandleStore>;
	runtime: MediaResolverRuntime;
}) => {
	const objectUrls = new Map<string, string>();
	const inflight = new Set<string>();

	const resolveResourceUrl = (resourceId: string, fallbackUrl: string): string => {
		return objectUrls.get(resourceId) ?? fallbackUrl;
	};

	const restoreResource = async (
		resource: LocalMediaResourceSnapshot,
	): Promise<string | null> => {
		if (resource.sourceKind !== "file-handle") {
			return null;
		}
		const resourceId = resource.resourceId;
		if (!resourceId) {
			return null;
		}
		const cached = objectUrls.get(resourceId);
		if (cached) {
			return cached;
		}
		if (inflight.has(resourceId)) {
			return null;
		}
		inflight.add(resourceId);
		try {
			const sourceRef =
				typeof resource.sourceRef === "string" && resource.sourceRef
					? resource.sourceRef
					: resourceId;
			const record = await handleStore.get(sourceRef);
			if (!record?.handle) {
				runtime.setResourceStatus(resourceId, "missing");
				return null;
			}
			const permission = asHandlePermission(
				await record.handle.queryPermission?.({ mode: "read" }),
			);
			if (permission !== "granted") {
				runtime.setResourceStatus(resourceId, "needs-permission");
				return null;
			}
			const file = await record.handle.getFile();
			const objectUrl = runtime.createObjectUrl(file);
			if (!objectUrl) {
				runtime.setResourceStatus(resourceId, "missing");
				return null;
			}
			const previous = objectUrls.get(resourceId);
			if (previous && previous !== objectUrl) {
				runtime.revokeObjectUrl(previous);
			}
			objectUrls.set(resourceId, objectUrl);
			runtime.setResourceStatus(resourceId, "ready");
			return objectUrl;
		} catch {
			runtime.setResourceStatus(resourceId, "missing");
			return null;
		} finally {
			inflight.delete(resourceId);
		}
	};

	const restoreResources = async (
		resources: LocalMediaResourceSnapshot[],
	): Promise<void> => {
		await Promise.all(resources.map((resource) => restoreResource(resource)));
	};

	const destroy = (): void => {
		for (const url of objectUrls.values()) {
			runtime.revokeObjectUrl(url);
		}
		objectUrls.clear();
		inflight.clear();
	};

	return {
		resolveResourceUrl,
		restoreResource,
		restoreResources,
		destroy,
	};
};
