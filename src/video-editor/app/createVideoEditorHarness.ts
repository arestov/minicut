import { createMiniCutPageSyncRuntime } from "../dkt/runtime/createMiniCutPageSyncRuntime";
import { DEFAULT_RESOURCE_CHUNK_SIZE } from "../domain/resourceData";
import { createResourceTransferManager } from "../media/resourceTransferManager";
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

			disposeProjectResources();

			const syncResources = () => {
				const attrs = pageRuntime.readAttrs(activeProjectScope, [
					"resourceTransferManifest",
				]) as {
					resourceTransferManifest?: unknown;
				};
				const manifest = Array.isArray(attrs.resourceTransferManifest)
					? attrs.resourceTransferManifest
					: [];
				const resources = manifest
					.map((entry) => {
						const item = entry as {
							resourceId?: unknown;
							attrs?: unknown;
						} | null;
						if (
							!item ||
							typeof item.resourceId !== "string" ||
							!item.resourceId
						) {
							return null;
						}
						if (!item.attrs || typeof item.attrs !== "object") {
							return null;
						}
						return {
							resourceId: item.resourceId,
							attrs: item.attrs as ResourceAttrs,
						};
					})
					.filter(
						(entry): entry is { resourceId: string; attrs: ResourceAttrs } =>
							entry !== null,
					);

				resourceTransferManager.syncResources(resources);
			};

			const unsubscribe = pageRuntime.subscribeAttrs(
				activeProjectScope,
				["resourceTransferManifest"],
				syncResources,
			);
			disposeProjectResources = () => {
				unsubscribe();
			};
			syncResources();
		};

		const disposeActiveProject = pageRuntime.subscribeRootScope(() => {
			syncActiveProjectResources();
		});

		syncActiveProjectResources();

		return () => {
			disposeProjectResources();
			disposeActiveProject();
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
				resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl),
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
			return resourceTransferManager.resolveResourceUrl(
				resourceId,
				fallbackUrl,
			);
		},

		requestResourcePlayheadWindow(resourceId: string, time: number): void {
			resourceTransferManager.requestPlayheadWindow(resourceId, time);
		},

		noteResourcePreviewError(resourceId: string): void {
			resourceTransferManager.notePreviewError(resourceId);
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
			resourceTransferManager.destroy();
			pageRuntime?.destroy();
			authorityClient.destroy?.();
		},
	};
};

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>;
