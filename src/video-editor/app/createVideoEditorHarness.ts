import { createMiniCutPageSyncRuntime } from "../dkt/runtime/createMiniCutPageSyncRuntime";
import type { ReactSyncScopeHandle } from "../../dkt-react-sync/scope/ScopeHandle";
import { DEFAULT_RESOURCE_CHUNK_SIZE } from "../domain/resourceData";
import { createResourceTransferManager } from "../media/resourceTransferManager";
import { browserProjectAssetRoot, createProjectAssetStore, type ProjectAssetStore } from "../media/projectAssetStore";
import { createMediaRelinkService, type RelinkIntent } from "../media/mediaRelinkService";
import {
	createLocalMediaResolver,
	type LocalMediaResourceSnapshot,
} from "../media/localMediaResolver";
import {
	isProjectImportFilesEffectData,
	PROJECT_IMPORT_FILES_FX,
	PROJECT_RENDER_EXPORT_FX,
} from "../models/Project/effects";
import type { ExportRenderer } from "../render/exportRenderer";
import type { ResourceAttrs } from "../render/registryTypes";
import type { EditorAuthorityClient } from "../worker/authorityClient";
import {
	AUTH_EXT_CHANNEL,
	AUTH_EXT_EVENT,
	createAuthorityExtensionBus,
} from "./authorityExtensionBus";
import type {
	EditorActionEnvironment,
	EditorDktScopePort,
} from "./editorActionEnvironment";
import { createEditorHarnessAdapter } from "./editorHarnessAdapter";
import { createLocalMediaHandleStore } from "./mediaHandleStore";
import { parseExportRequest } from "./exportRequestState";
import { executeImportFilesTask } from "./importFilesTaskExecutor";
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from "./platform";
import { executeRenderExportTask } from "./renderExportTaskExecutor";
import { createRuntimeTaskFacade } from "./runtimeTaskFacade";

const EMPTY_CLEANUP = () => {};

const debugExport = (message: string, details?: unknown) => {
	if (
		(globalThis as { __MINICUT_EXPORT_DEBUG__?: unknown })
			.__MINICUT_EXPORT_DEBUG__ !== true
	) {
		return;
	}
	console.info("[minicut:export:harness]", message, details);
};

const parseExportChannelPayload = (payload: unknown) => {
	const envelope =
		payload && typeof payload === "object"
			? (payload as { request?: unknown; queueKey?: unknown })
			: null;
	const request = parseExportRequest(envelope?.request ?? payload);
	const queueKey =
		typeof envelope?.queueKey === "string" && envelope.queueKey
			? envelope.queueKey
			: null;
	return { request, queueKey };
};

const parseImportFilesChannelPayload = (payload: unknown) => {
	const value =
		payload && typeof payload === "object"
			? (payload as {
					projectId?: unknown;
					inputBatchHandleId?: unknown;
					addToTimelineWhenEmpty?: unknown;
				})
			: null;
	if (
		!value ||
		typeof value.inputBatchHandleId !== "string" ||
		!value.inputBatchHandleId
	) {
		return null;
	}
	return {
		projectId:
			typeof value.projectId === "string" && value.projectId
				? value.projectId
				: "active-project",
		inputBatchHandleId: value.inputBatchHandleId,
		addToTimelineWhenEmpty: value.addToTimelineWhenEmpty !== false,
	};
};

const getFileKind = (file: File): "video" | "audio" | "image" | null => {
	if (file.type.startsWith("video/")) {
		return "video";
	}
	if (file.type.startsWith("audio/")) {
		return "audio";
	}
	if (file.type.startsWith("image/")) {
		return "image";
	}

	const lowerName = file.name.toLowerCase();
	if (/\.(mp4|webm|mov|mkv)$/.test(lowerName)) {
		return "video";
	}
	if (/\.(wav|mp3|ogg|m4a|aac)$/.test(lowerName)) {
		return "audio";
	}
	if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lowerName)) {
		return "image";
	}

	return null;
};

const createMiniCutPageRuntime = (authorityClient: EditorAuthorityClient) => {
	if (typeof authorityClient.openDktTransport !== "function") {
		return null;
	}

	return createMiniCutPageSyncRuntime({
		transport: authorityClient.openDktTransport(),
	});
};

interface CreateVideoEditorHarnessOptions {
	exportRenderer?: ExportRenderer;
	platform?: VideoEditorHarnessPlatform;
	projectAssets?: ProjectAssetStore;
	mediaTransferOptions?: {
		chunkSize?: number;
		chunkSendDelayMs?: number;
		headBytes?: number;
		tailBytes?: number;
		playheadWindowSeconds?: number;
	};
}

/**
 * Phase 1 hard rewrite: DKT-only harness.
 * No legacy registry stores, state mirrors, registry reads, or source-id lookups.
 * Only DKT page runtime, platform boundary, and task ports.
 */
export const createVideoEditorHarness = (
	authority?: EditorAuthorityClient,
	options: CreateVideoEditorHarnessOptions = {},
) => {
	let authorityClientRef: EditorAuthorityClient | null = null;
	const resourceChunkSize =
		options.mediaTransferOptions?.chunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE;
	const resourceTransferManager = createResourceTransferManager({
		getRole: () => {
			const role = (authorityClientRef as Partial<{ role: unknown }> | null)
				?.role;
			return role === "server" || role === "client" || role === "undecided"
				? role
				: null;
		},
		getPeerId: () => {
			const peerId = (authorityClientRef as Partial<{ peerId: unknown }> | null)
				?.peerId;
			return typeof peerId === "string" ? peerId : null;
		},
		chunkSize: resourceChunkSize,
		chunkSendDelayMs: options.mediaTransferOptions?.chunkSendDelayMs,
		headBytes: options.mediaTransferOptions?.headBytes,
		tailBytes: options.mediaTransferOptions?.tailBytes,
		playheadWindowSeconds: options.mediaTransferOptions?.playheadWindowSeconds,
	});

	const platform =
		options.platform ??
		createBrowserHarnessPlatform({
			exportRenderer: options.exportRenderer,
		});

	const authorityClient =
		authority ??
		platform.createAuthorityClient({
			onClientResourceTransport: (transport) => {
				resourceTransferManager.attachClientTransport(transport);
			},
			onServerResourceTransport: (remotePeerId, transport) => {
				resourceTransferManager.attachServerTransport(remotePeerId, transport);
			},
			onResourcePeerDisconnected: (remotePeerId) => {
				resourceTransferManager.detachPeerTransport(remotePeerId);
			},
		});
	authorityClientRef = authorityClient;

	const exportRenderer =
		options.exportRenderer ?? platform.createExportRenderer();
	const pageRuntime = createMiniCutPageRuntime(authorityClient);
	const runtimeTasks = createRuntimeTaskFacade();
	const extensionBus = createAuthorityExtensionBus();

	let isDestroyed = false;
	const importedObjectUrls = new Set<string>();
	const exportObjectUrls = new Set<string>();
	const startedImportHandles = new Set<string>();
	const mediaHandleStore = createLocalMediaHandleStore();
	const projectAssets = options.projectAssets ?? createProjectAssetStore(browserProjectAssetRoot);
	const readActiveProjectResourceScopes = (): ReactSyncScopeHandle[] => {
		const rootScope = pageRuntime?.getRootScope();
		if (!pageRuntime || !rootScope) {
			return [];
		}
		const activeProjectScope = pageRuntime.readOne(rootScope, "activeProject");
		return activeProjectScope
			? [...pageRuntime.readMany(activeProjectScope, "resources")]
			: [];
	};
	const localMediaResolver = createLocalMediaResolver({
		handleStore: mediaHandleStore,
		projectAssets,
		runtime: {
			createObjectUrl: (blob) => platform.createObjectUrl(blob),
			revokeObjectUrl: (url) => platform.revokeObjectUrl(url),
			setLocalMediaStatus: (resourceId, status) => {
				const resourceScope = readActiveProjectResourceScopes().find(
					(scope) => scope._nodeId === resourceId,
				);
				if (resourceScope) {
					pageRuntime?.dispatch("setLocalMediaStatus", status, resourceScope);
				}
			},
		},
	});
	const fingerprintFile = async (file: File) => {
		const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
		return { fingerprint: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""), version: "sha256-v1" };
	};
	const mediaRelinkService = createMediaRelinkService({
		handles: mediaHandleStore,
		assets: projectAssets,
		probe: async (file) => {
			const kind = getFileKind(file);
			if (!kind) throw new Error("Unsupported media kind");
			const probeUrl = platform.createObjectUrl(file);
			if (!probeUrl) throw new Error("Cannot probe media");
			try {
				const duration = await platform.getImportedResourceDuration(probeUrl, kind);
				return { kind, duration, streams: { videoStreams: kind === "video" ? 1 : 0, audioStreams: kind === "audio" || kind === "video" ? 1 : 0 } };
			} finally { platform.revokeObjectUrl(probeUrl); }
		},
		fingerprint: fingerprintFile,
		createObjectUrl: (file) => platform.createObjectUrl(file),
		revokeObjectUrl: (url) => platform.revokeObjectUrl(url),
		complete: (payload) => {
			const resourceId = String(payload.resourceId ?? "");
			const scope = readActiveProjectResourceScopes().find((item) => item._nodeId === resourceId);
			if (!scope) throw new Error("Resource no longer exists");
			const current = pageRuntime?.readAttrs(scope, ["name", "kind", "url", "mime", "duration", "width", "height", "size", "lastModified", "sourceKind", "sourceRef", "source", "status", "data", "assetStorageKind", "assetRef", "contentFingerprint", "fingerprintVersion", "localMediaStatus"]) ?? {};
			pageRuntime?.dispatch("setResourceAttrs", { ...current, ...payload, sourceKind: "file-handle", sourceRef: resourceId, localMediaStatus: "ready-project-copy" }, scope);
		},
		activate: (resourceId, url) => localMediaResolver.activateObjectUrl(resourceId, url),
		now: () => Date.now(),
	});

	const subscribeToResourceScopes = (): (() => void) => {
		if (!pageRuntime) {
			return EMPTY_CLEANUP;
		}

		let disposeProjectResources = EMPTY_CLEANUP;

		const syncActiveProjectResources = () => {
			const rootScope = pageRuntime.getRootScope();
			if (!rootScope) {
				resourceTransferManager.syncResources([]);
				return;
			}

			const activeProjectScope = pageRuntime.readOne(
				rootScope,
				"activeProject",
			);
			if (!activeProjectScope) {
				resourceTransferManager.syncResources([]);
				return;
			}
			void projectAssets.cleanupStaleTemporaryEntries(activeProjectScope._nodeId);

			disposeProjectResources();

			let disposeResourceAttrs = EMPTY_CLEANUP;
			const syncResources = () => {
				const resourceScopes = pageRuntime.readMany(
					activeProjectScope,
					"resources",
				);
				const resources = resourceScopes
					.map((scope) => {
						const resourceId =
							typeof scope._nodeId === "string" ? scope._nodeId : "";
						if (!resourceId) {
							return null;
						}
						const attrs = pageRuntime.readAttrs(scope, [
							"name",
							"kind",
							"url",
							"mime",
							"duration",
							"width",
							"height",
							"size",
							"lastModified",
							"sourceKind",
							"sourceRef",
							"source",
							"status",
							"data",
							"assetStorageKind",
							"assetRef",
						]) as unknown as ResourceAttrs;

						return {
							resourceId,
							attrs,
						};
					})
					.filter(
						(entry): entry is { resourceId: string; attrs: ResourceAttrs } =>
							entry !== null,
					);

				resourceTransferManager.syncResources(resources);
				void localMediaResolver.restoreResources(
					resources.map(({ resourceId, attrs }) => ({
						resourceId,
						projectId: activeProjectScope._nodeId,
						assetStorageKind: (attrs as { assetStorageKind?: unknown }).assetStorageKind ?? (attrs.source as { assetStorageKind?: unknown } | null)?.assetStorageKind,
						assetRef: (attrs as { assetRef?: unknown }).assetRef ?? (attrs.source as { assetRef?: unknown } | null)?.assetRef,
						sourceKind: (attrs as { sourceKind?: unknown }).sourceKind,
						sourceRef: (attrs as { sourceRef?: unknown }).sourceRef,
						status: (attrs as { status?: unknown }).status,
						url: (attrs as { url?: unknown }).url,
					}) satisfies LocalMediaResourceSnapshot),
				);
			};

			const syncResourceSubscriptions = () => {
				disposeResourceAttrs();
				const resourceScopes = pageRuntime.readMany(
					activeProjectScope,
					"resources",
				);
				const unsubscribers = resourceScopes.map((scope) =>
					pageRuntime.subscribeAttrs(
						scope,
						[
							"name",
							"kind",
							"url",
							"mime",
							"duration",
							"width",
							"height",
							"size",
							"lastModified",
							"sourceKind",
							"sourceRef",
							"source",
							"status",
							"data",
							"assetStorageKind",
							"assetRef",
						],
						syncResources,
					),
				);
				disposeResourceAttrs = () => {
					for (const unsubscribe of unsubscribers) {
						unsubscribe();
					}
				};
				syncResources();
			};

			const unsubscribeResources = pageRuntime.subscribeMany(
				activeProjectScope,
				"resources",
				syncResourceSubscriptions,
			);
			disposeProjectResources = () => {
				unsubscribeResources();
				disposeResourceAttrs();
			};
			syncResourceSubscriptions();
		};

		let disposeActiveProjectRel = EMPTY_CLEANUP;
		const resubscribeActiveProjectRel = () => {
			disposeActiveProjectRel();
			disposeActiveProjectRel = EMPTY_CLEANUP;
			const rootScope = pageRuntime.getRootScope();
			if (rootScope) {
				disposeActiveProjectRel = pageRuntime.subscribeOne(
					rootScope,
					"activeProject",
					syncActiveProjectResources,
				);
			}
			syncActiveProjectResources();
		};
		const disposeRootScope = pageRuntime.subscribeRootScope(
			resubscribeActiveProjectRel,
		);

		resubscribeActiveProjectRel();

		return () => {
			disposeProjectResources();
			disposeActiveProjectRel();
			disposeRootScope();
		};
	};

	const unsubscribe = subscribeToResourceScopes();

	const subscribeToDownloadBridge = (): (() => void) =>
		extensionBus.subscribe(AUTH_EXT_CHANNEL.EXPORT_DOWNLOAD, (event) => {
			if (event.event !== AUTH_EXT_EVENT.EXPORT_READY) {
				return;
			}
			const payload = event.payload as {
				downloadUrl?: unknown;
				fileName?: unknown;
				targetPeerId?: unknown;
			} | null;
			if (!payload || typeof payload !== "object") {
				return;
			}
			if (typeof document === "undefined") {
				return;
			}
			const downloadUrl =
				typeof payload.downloadUrl === "string" ? payload.downloadUrl : null;
			if (!downloadUrl) {
				return;
			}
			const localPeerId = env.transfers.getPeerId();
			const targetPeerId =
				typeof payload.targetPeerId === "string" ? payload.targetPeerId : null;
			if (
				targetPeerId !== null &&
				localPeerId !== null &&
				targetPeerId !== localPeerId
			) {
				return;
			}
			const fileName =
				typeof payload.fileName === "string" && payload.fileName
					? payload.fileName
					: "export.webm";
			const anchor = document.createElement("a");
			anchor.href = downloadUrl;
			anchor.download = fileName;
			document.body.appendChild(anchor);
			anchor.click();
			document.body.removeChild(anchor);
		});

	const dktPort: EditorDktScopePort | null = pageRuntime
		? {
				dispatch: (actionName, payload, scope) =>
					pageRuntime.dispatch(actionName, payload, scope ?? null),
			}
		: null;

	const env: EditorActionEnvironment = {
		pageRuntime,
		dkt: dktPort,
		media: {
			getFileKind,
			createObjectUrl: (blob) => platform.createObjectUrl(blob),
			revokeObjectUrl: (url) => platform.revokeObjectUrl(url),
			getImportedResourceDuration: (url, kind) =>
				platform.getImportedResourceDuration(url, kind),
			fingerprintFile,
			estimateStorage: async () => {
				try { return await navigator.storage?.estimate?.() ?? {}; } catch { return {}; }
			},
		},
		export: {
			renderer: exportRenderer,
			cachedResults: new Map<
				string,
				{ downloadUrl: string; blob: Blob; timestamp: number }
			>(),
		},
		transfers: {
			manager: resourceTransferManager,
			getPeerId: () => {
				const peerId = (
					authorityClientRef as Partial<{ peerId: unknown }> | null
				)?.peerId;
				return typeof peerId === "string" ? peerId : null;
			},
			resolveResourceUrl: (resourceId, fallbackUrl) =>
				localMediaResolver.resolveResourceUrl(
					resourceId,
					resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl),
				),
			requestPlayheadWindow: (resourceId, time) =>
				resourceTransferManager.requestPlayheadWindow(resourceId, time),
			notePreviewError: (resourceId) =>
				resourceTransferManager.notePreviewError(resourceId),
		},
		lifecycle: {
			isDestroyed: () => isDestroyed,
			setTimeout: (handler, ms) => platform.setTimeout(handler, ms),
			clearTimeout: (id) => platform.clearTimeout(id),
			registerObjectUrl: (url, bucket) => {
				if (bucket === "export") {
					exportObjectUrls.add(url);
				} else {
					importedObjectUrls.add(url);
				}
			},
		},
		tasks: runtimeTasks,
		mediaHandles: mediaHandleStore,
		projectAssets,
		platform,
		resourceChunkSize,
	};

	const actions = createEditorHarnessAdapter(env);

	const startImportFilesTask = (payload: unknown): void => {
		const importPayload = parseImportFilesChannelPayload(payload);
		if (!importPayload || !isProjectImportFilesEffectData(importPayload)) {
			return;
		}
		if (startedImportHandles.has(importPayload.inputBatchHandleId)) {
			return;
		}
		startedImportHandles.add(importPayload.inputBatchHandleId);
		const task = runtimeTasks.dispatchTask(
			PROJECT_IMPORT_FILES_FX,
			{
				data: importPayload,
			},
			{
				queuePolicy: "queue-all",
				intentKey: `${PROJECT_IMPORT_FILES_FX}:${importPayload.inputBatchHandleId}`,
			},
		);
		if (task.dropped) {
			return;
		}
		void executeImportFilesTask({ task, env });
	};

	const subscribeToRenderExportTasks = (): (() => void) => {
		if (!pageRuntime || !dktPort) {
			return EMPTY_CLEANUP;
		}

		const unlistenExportRequest =
			pageRuntime.subscribeRuntimeTaskRequests?.(
				PROJECT_RENDER_EXPORT_FX,
				(payload) => {
					const { request, queueKey } = parseExportChannelPayload(payload);
					if (!request) {
						debugExport(
							"channel export request ignored: invalid payload",
							payload,
						);
						return;
					}
					debugExport("channel export request observed", { id: request.id });
					const intentKey = queueKey
						? `${PROJECT_RENDER_EXPORT_FX}:${queueKey}`
						: request.range.type === "clip"
							? `${PROJECT_RENDER_EXPORT_FX}:clip:${request.range.clipId}`
							: `${PROJECT_RENDER_EXPORT_FX}:project`;
					const task = runtimeTasks.dispatchTask(
						PROJECT_RENDER_EXPORT_FX,
						{
							data: request,
						},
						{
							queuePolicy: "replace-last",
							intentKey,
						},
					);
					if (task.dropped) {
						return;
					}
					void executeRenderExportTask({
						task,
						env,
						extensionBus,
					});
				},
			) ?? EMPTY_CLEANUP;

		return () => {
			unlistenExportRequest();
		};
	};

	const subscribeToHandleInputFilesTasks = (): (() => void) => {
		if (!pageRuntime || !dktPort) {
			return EMPTY_CLEANUP;
		}

		const unlistenImportRequest =
			pageRuntime.subscribeRuntimeTaskRequests?.(
				PROJECT_IMPORT_FILES_FX,
				(payload) => {
					startImportFilesTask(payload);
				},
			) ?? EMPTY_CLEANUP;

		return () => {
			unlistenImportRequest();
		};
	};

	const subscribeToImportProgressRequests = (): (() => void) => {
		if (!pageRuntime || !dktPort) {
			return EMPTY_CLEANUP;
		}

		let disposeProjectImportState = EMPTY_CLEANUP;

		const syncActiveProjectImportState = () => {
			const rootScope = pageRuntime.getRootScope();
			if (!rootScope) {
				return;
			}
			const activeProjectScope = pageRuntime.readOne(
				rootScope,
				"activeProject",
			);
			if (!activeProjectScope) {
				return;
			}

			disposeProjectImportState();

			const syncImportState = () => {
				const attrs = pageRuntime.readAttrs(activeProjectScope, [
					"activeImportTaskId",
					"importProgress",
				]) as {
					activeImportTaskId?: unknown;
					importProgress?: { stage?: unknown } | null;
				};
				if (
					typeof attrs.activeImportTaskId !== "string" ||
					!attrs.activeImportTaskId ||
					attrs.importProgress?.stage !== "queued"
				) {
					return;
				}
				startImportFilesTask({
					projectId:
						typeof activeProjectScope._nodeId === "string" &&
						activeProjectScope._nodeId
							? activeProjectScope._nodeId
							: "active-project",
					inputBatchHandleId: attrs.activeImportTaskId,
					addToTimelineWhenEmpty: true,
				});
			};

			const unsubscribe = pageRuntime.subscribeAttrs(
				activeProjectScope,
				["activeImportTaskId", "importProgress"],
				syncImportState,
			);
			disposeProjectImportState = () => {
				unsubscribe();
			};
			syncImportState();
		};

		let disposeActiveProjectRel = EMPTY_CLEANUP;
		const resubscribeActiveProjectRel = () => {
			disposeActiveProjectRel();
			disposeActiveProjectRel = EMPTY_CLEANUP;
			const rootScope = pageRuntime.getRootScope();
			if (rootScope) {
				disposeActiveProjectRel = pageRuntime.subscribeOne(
					rootScope,
					"activeProject",
					syncActiveProjectImportState,
				);
			}
			syncActiveProjectImportState();
		};
		const disposeRootScope = pageRuntime.subscribeRootScope(
			resubscribeActiveProjectRel,
		);

		resubscribeActiveProjectRel();

		return () => {
			disposeProjectImportState();
			disposeActiveProjectRel();
			disposeRootScope();
		};
	};

	const unsubscribeDownloadBridge = subscribeToDownloadBridge();
	const unsubscribeRenderExportTasks = subscribeToRenderExportTasks();
	const unsubscribeHandleInputFilesTasks = subscribeToHandleInputFilesTasks();
	const unsubscribeImportProgressRequests = subscribeToImportProgressRequests();

	return {
		// Only essential public API
		worker: authorityClient,
		pageRuntime,
		actions,
		resourceTransfers$: resourceTransferManager.transfers$,
		resourceChunkSize,
		media: env.media,
		transfers: env.transfers,
		lifecycle: env.lifecycle,
		// TESTING AND DEBUG ONLY — queue snapshot for fx task diagnostics.
		debugDumpRuntimeTasksTesting: () => runtimeTasks.debugDumpTasksTesting(),

		resolveResourceUrl(resourceId: string, fallbackUrl: string): string {
			return localMediaResolver.resolveResourceUrl(
				resourceId,
				resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl),
			);
		},

		requestResourcePlayheadWindow(resourceId: string, time: number): void {
			resourceTransferManager.requestPlayheadWindow(resourceId, time);
		},

		noteResourcePreviewError(resourceId: string): void {
			resourceTransferManager.notePreviewError(resourceId);
		},

		async reconnectResourceMedia(resourceId: string): Promise<void> {
			const result = await this.inspectRelinkCandidate(resourceId, "locate-original");
			if (result?.policy.classification === "exact-match") await mediaRelinkService.commitResourceRelink(result.operationId);
		},

		requestResourceAccess(resourceId: string) {
			return localMediaResolver.requestResourceAccess(resourceId);
		},

		async inspectRelinkCandidate(resourceId: string, intent: RelinkIntent) {
			const picker = (globalThis as typeof globalThis & { showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
			if (typeof picker !== "function") return null;
			const [handle] = await picker({ multiple: false }).catch(() => []);
			if (!handle) return null;
			const resourceScope = readActiveProjectResourceScopes().find((scope) => scope._nodeId === resourceId);
			const root = pageRuntime?.getRootScope();
			const project = root ? pageRuntime?.readOne(root, "activeProject") : null;
			if (!resourceScope || !project) return null;
			const attrs = pageRuntime?.readAttrs(resourceScope, ["kind", "duration", "width", "height", "contentFingerprint", "fingerprintVersion", "requiredSourceEnd"]) as Record<string, unknown>;
			const kind = attrs.kind === "audio" || attrs.kind === "image" ? attrs.kind : "video";
			return mediaRelinkService.inspectRelinkCandidate({
				resourceId, projectId: project._nodeId, intent,
				original: { kind, duration: Number(attrs.duration), width: typeof attrs.width === "number" ? attrs.width : null, height: typeof attrs.height === "number" ? attrs.height : null, streams: { videoStreams: kind === "video" ? 1 : 0, audioStreams: kind === "audio" || kind === "video" ? 1 : 0 } },
				requiredSourceEnd: Number(attrs.requiredSourceEnd ?? 0),
				originalFingerprint: typeof attrs.contentFingerprint === "string" ? attrs.contentFingerprint : null,
				fingerprintVersion: typeof attrs.fingerprintVersion === "string" ? attrs.fingerprintVersion : null,
				candidateHandle: handle,
			});
		},

		commitResourceRelink(operationId: string, confirmationToken?: string) {
			return mediaRelinkService.commitResourceRelink(operationId, confirmationToken);
		},

		destroy(): void {
			isDestroyed = true;
			runtimeTasks.clear();
			unsubscribe();
			unsubscribeDownloadBridge();
			unsubscribeRenderExportTasks();
			unsubscribeHandleInputFilesTasks();
			unsubscribeImportProgressRequests();
			for (const url of importedObjectUrls) {
				platform.revokeObjectUrl(url);
			}
			for (const url of exportObjectUrls) {
				platform.revokeObjectUrl(url);
			}
			extensionBus.clear();
			env.export.cachedResults.clear();
			localMediaResolver.destroy();
			resourceTransferManager.destroy();
			pageRuntime?.destroy();
			authorityClient.destroy?.();
		},
	};
};

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>;
