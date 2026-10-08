import {
	createMiniCutPageSyncRuntime,
} from "../dkt/runtime/createMiniCutPageSyncRuntime";
import { WORKSPACE_OPEN_STATUS } from "../dkt/runtime/workspaceOpenState";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import { DEFAULT_RESOURCE_CHUNK_SIZE } from "../domain/resourceData";
import { createResourceTransferManager } from "../media/resourceTransferManager";
import type { ProjectAssetStore } from "../media/projectAssetStore";
import { fingerprintMediaFile } from "../media/mediaContentFingerprint";
import type { HarnessMediaProbeResult } from "./platform/types";
import { commitRecoveryStorage } from "../media/mediaRecoveryStorageCommit";
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
import { executeMediaRecoveryInspectionTask } from "./mediaRecoveryTaskExecutor";
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from "./platform";
import { executeRenderExportTask } from "./renderExportTaskExecutor";
import { createRuntimeTaskFacade } from "./runtimeTaskFacade";
import {
	PlaybackRuntime,
	type PlaybackRun,
} from "../playback/playbackRuntime";

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

const createMiniCutPageRuntime = (
	authorityClient: EditorAuthorityClient,
	platform: VideoEditorHarnessPlatform,
) => {
	if (typeof authorityClient.openDktTransport !== "function") {
		return null;
	}

	return createMiniCutPageSyncRuntime({
		transport: authorityClient.openDktTransport(),
		resolveCrdtBridgeSender: () => platform.resolveCrdtBridgeSender(),
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
	const mediaRecoveryBootId = `boot:${crypto.randomUUID()}`;
	const startedRecoveryResources = new Set<string>();
	const recoveringResources = new Map<string, Promise<void>>();
	const committingRecoveryOperations = new Set<string>();
	const hydratedRecoveryResources = new Set<string>();
	const capturedHydratedProjects = new Set<string>();
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
	const pageRuntime = createMiniCutPageRuntime(authorityClient, platform);
	const playback = new PlaybackRuntime({
		clock: platform.playbackClock,
		onComplete(completion) {
			pageRuntime?.dispatch("completePlayback", completion);
		},
	});
	const runtimeTasks = createRuntimeTaskFacade();
	const extensionBus = createAuthorityExtensionBus();

	let isDestroyed = false;
	const importedObjectUrls = new Set<string>();
	const exportObjectUrls = new Set<string>();
	const startedImportHandles = new Set<string>();
	const mediaHandleStore = createLocalMediaHandleStore();
	const projectAssets = options.projectAssets ?? platform.createProjectAssetStore();
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
			setLocalMediaAxes: (resourceId, state) => {
				const resourceScope = readActiveProjectResourceScopes().find((scope) => scope._nodeId === resourceId);
				if (resourceScope) pageRuntime?.dispatch("recordAutomaticMediaRecovery", { ...state, updatedAt: Date.now() }, resourceScope);
			},
		},
	});
	const fingerprintFile = fingerprintMediaFile;
	const subscribeToResourceScopes = (): (() => void) => {
		if (!pageRuntime) {
			return EMPTY_CLEANUP;
		}

		let disposeProjectResources = EMPTY_CLEANUP;

		const syncActiveProjectResources = () => {
			const workspaceStatus = pageRuntime.getSnapshot().workspaceOpenState?.status;
			if (workspaceStatus !== WORKSPACE_OPEN_STATUS.READY && workspaceStatus !== WORKSPACE_OPEN_STATUS.LOCAL_EMPTY_READY) return;
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
				if (!capturedHydratedProjects.has(activeProjectScope._nodeId)) {
					for (const { resourceId } of resources) hydratedRecoveryResources.add(`${activeProjectScope._nodeId}:${resourceId}`);
					capturedHydratedProjects.add(activeProjectScope._nodeId);
				}
				for (const { resourceId, attrs } of resources) {
					if (!hydratedRecoveryResources.has(`${activeProjectScope._nodeId}:${resourceId}`)) continue;
					const durableStorageKind = (attrs as { assetStorageKind?: unknown }).assetStorageKind ?? (attrs.source as { assetStorageKind?: unknown } | null)?.assetStorageKind;
					const durableAssetRef = (attrs as { assetRef?: unknown }).assetRef ?? (attrs.source as { assetRef?: unknown } | null)?.assetRef;
					if (typeof durableStorageKind !== "string" || typeof (attrs as { sourceKind?: unknown }).sourceKind !== "string" || typeof attrs.status !== "string") continue;
					if (durableStorageKind === "project-copy" && typeof durableAssetRef !== "string") continue;
					// Host asset-registry resources are not recoverable by the web loop; it would rewrite sourceKind/sourceRef.
					if ((attrs as { sourceKind?: unknown }).sourceKind === "local-asset") continue;
					if (startedRecoveryResources.has(resourceId)) continue;
					if (recoveringResources.has(resourceId)) continue;
					const resourceScope = { kind: "scope" as const, _nodeId: resourceId };
					const durableSourceRef = (attrs as { sourceRef?: unknown }).sourceRef;
					const snapshot = { resourceId, projectId: activeProjectScope._nodeId, assetStorageKind: durableStorageKind, assetRef: durableAssetRef, sourceKind: (attrs as { sourceKind?: unknown }).sourceKind, sourceRef: durableSourceRef, handleRef: durableSourceRef, bootId: mediaRecoveryBootId, attemptId: `${mediaRecoveryBootId}:${resourceId}` } satisfies LocalMediaResourceSnapshot;
					const recovery = (async () => {
						await new Promise<void>((resolve) => platform.setTimeout(resolve, 0));
						const assetRef = typeof snapshot.assetRef === "string" ? snapshot.assetRef : null;
						const handleRef = typeof snapshot.sourceRef === "string" && snapshot.sourceRef.includes("/handle/") ? snapshot.sourceRef : null;
						await projectAssets.reconcile(activeProjectScope._nodeId, resourceId, assetRef);
						await mediaHandleStore.reconcile(resourceId, handleRef);
						if (!startedRecoveryResources.has(resourceId)) {
							startedRecoveryResources.add(resourceId);
							pageRuntime.dispatch("startMediaRecovery", { operationId: `${mediaRecoveryBootId}:${resourceId}`, attemptId: `${mediaRecoveryBootId}:${resourceId}`, bootId: mediaRecoveryBootId, recoveryKind: "restore", intent: "restore", createdAt: Date.now(), updatedAt: Date.now() }, resourceScope);
						}
						await localMediaResolver.restoreResource(snapshot);
					})().finally(() => recoveringResources.delete(resourceId));
					recoveringResources.set(resourceId, recovery);
				}
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
		const disposeWorkspaceState = pageRuntime.subscribe(resubscribeActiveProjectRel);

		resubscribeActiveProjectRel();

		return () => {
			disposeProjectResources();
			disposeActiveProjectRel();
			disposeWorkspaceState();
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
			platform.downloadFile(downloadUrl, fileName);
		});

	const dktPort: EditorDktScopePort | null = pageRuntime
		? {
				dispatch: (actionName, payload, scope) =>
					pageRuntime.dispatch(actionName, payload, scope ?? null),
				dispatchAndWait: (actionName, payload, scope) =>
					pageRuntime.dispatchAndWait(actionName, payload, scope ?? null),
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
			probeAudioStreams: (file) => platform.probeAudioStreams(file),
			fingerprintFile,
			estimateStorage: async () => {
				return platform.estimateStorage();
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

	const subscribeToMediaRecoveryTasks = (): (() => void) => {
		if (!pageRuntime || !dktPort) return EMPTY_CLEANUP;
		const commitRequest = async (request: Record<string, unknown>) => {
					const resourceId = String(request.resourceId ?? ""); const taskId = String(request.taskId ?? ""); const operationId = String(request.operationId ?? "");
					if (!operationId || committingRecoveryOperations.has(operationId)) return;
					committingRecoveryOperations.add(operationId);
					await new Promise<void>((resolve) => platform.setTimeout(resolve, 0));
					const resourceScope = readActiveProjectResourceScopes().find((scope) => scope._nodeId === resourceId); const root = pageRuntime.getRootScope(); const project = root ? pageRuntime.readOne(root, "activeProject") : null;
					if (!resourceScope || !project) return;
					const runtime = runtimeTasks.getRuntimeRef(String(request.runtimeHandleId ?? "")) as { file?: File; handle?: FileSystemFileHandle } | null;
					if (!(runtime?.file instanceof File)) { pageRuntime.dispatch("transition", { operationId, phase: "failed", reasonCode: "runtime-ref-expired", errorMessage: "Choose the file again.", updatedAt: Date.now() }, { kind: "scope", _nodeId: taskId }); return; }
					const url = platform.createObjectUrl(runtime.file); if (!url) return;
					const now = Date.now();
					const result = await commitRecoveryStorage({ projectId: project._nodeId, resourceId, operationId, file: runtime.file, handleRecord: runtime.handle ? { resourceId, handle: runtime.handle, name: runtime.file.name, size: runtime.file.size, lastModified: runtime.file.lastModified, mime: runtime.file.type || "application/octet-stream", createdAt: now, updatedAt: now } : null, assetMetadata: { name: runtime.file.name, mime: runtime.file.type || "application/octet-stream", size: runtime.file.size, lastModified: runtime.file.lastModified }, assets: projectAssets, handles: mediaHandleStore, fault: async (point) => {
						const testWindow = globalThis as typeof globalThis & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean; __MINICUT_MEDIA_RECOVERY_FAULT_POINT__?: string };
						if (testWindow.__MINICUT_ENABLE_DEBUG_BRIDGE__ === true && testWindow.__MINICUT_MEDIA_RECOVERY_FAULT_POINT__ === point) {
							delete testWindow.__MINICUT_MEDIA_RECOVERY_FAULT_POINT__;
							throw new Error(`Injected media recovery fault at ${point}`);
						}
					}, publish: async (refs) => {
						if (pageRuntime.readOne(resourceScope, "activeMediaRecoveryTask")?._nodeId !== taskId) return "noop";
						const metadata = request.candidateMetadata as Record<string, unknown> | null;
						const completion = { operationId, assetStorageKind: refs.assetRef ? "project-copy" : "linked", assetRef: refs.assetRef, sourceKind: refs.handleRef ? "file-handle" : "object-url", sourceRef: refs.handleRef, url, contentFingerprint: request.candidateFingerprint ?? null, fingerprintVersion: request.candidateFingerprintVersion ?? null, ...(typeof metadata?.duration === "number" ? { duration: metadata.duration } : {}), ...(typeof metadata?.width === "number" ? { width: metadata.width } : {}), ...(typeof metadata?.height === "number" ? { height: metadata.height } : {}), localMediaAvailability: refs.assetRef ? "ready-project-copy" : refs.handleRef ? "ready-file-handle" : "unknown", originalAccessStatus: refs.handleRef ? "granted" : "missing", updatedAt: Date.now() };
						await pageRuntime.dispatchAndWait("completePublication", completion, { kind: "scope", _nodeId: taskId });
						return "applied";
					} });
					if (result.ok) { localMediaResolver.activateObjectUrl(resourceId, url, result.assetRef ? "ready-project-copy" : result.handleRef ? "ready-file-handle" : "unknown"); runtimeTasks.deleteRuntimeRef(String(request.runtimeHandleId ?? "")); }
					else { platform.revokeObjectUrl(url); if (result.reason !== "stale") pageRuntime.dispatch("transition", { operationId, phase: "failed", reasonCode: result.reason, errorMessage: "Could not save the selected source. Try again.", updatedAt: Date.now() }, { kind: "scope", _nodeId: taskId }); }
		};
		return pageRuntime.subscribeRuntimeTaskRequests?.("$fx_mediaRecovery", (payload) => {
			const request = payload as Record<string, unknown>;
			if (request.mode === "commit") {
				void commitRequest(request);
				return;
			}
			if (request.intent === "restore" && typeof request.runtimeHandleId === "string") {
				const operationId = String(request.operationId); const taskId = String(request.taskId); const candidate = request.original;
				pageRuntime.dispatch("recordInspection", { operationId, classification: "exact-match", confirmationRequired: false, compatibility: { classification: "exact-match", reasons: [], requiresConfirmation: false, diff: {}, durationTolerance: 0 }, candidateMetadata: candidate, candidateFingerprint: request.originalFingerprint ?? null, candidateFingerprintVersion: request.fingerprintVersion ?? null, updatedAt: Date.now() }, { kind: "scope", _nodeId: taskId });
				pageRuntime.dispatch("requestCommit", { operationId, updatedAt: Date.now() }, { kind: "scope", _nodeId: taskId });
				return;
			}
			void executeMediaRecoveryInspectionTask({
				request: payload,
				consumeRuntimeRef: (id) => runtimeTasks.getRuntimeRef(id),
				probe: (file, signal) => {
					const testWindow = globalThis as typeof globalThis & { __MINICUT_ENABLE_DEBUG_BRIDGE__?: boolean; __MINICUT_MEDIA_PROBE_OVERRIDE__?: HarnessMediaProbeResult };
					return testWindow.__MINICUT_ENABLE_DEBUG_BRIDGE__ === true && testWindow.__MINICUT_MEDIA_PROBE_OVERRIDE__
						? Promise.resolve(testWindow.__MINICUT_MEDIA_PROBE_OVERRIDE__)
						: platform.probeMediaFile(file, signal);
				},
				fingerprint: (file, signal) => fingerprintFile(file, undefined, signal),
				dispatch: (action, value, target) => pageRuntime.dispatch(action, value, target),
				now: () => Date.now(),
			}).then((outcome) => { if (outcome?.policy.classification === "exact-match") pageRuntime.dispatch("requestCommit", { operationId: outcome.operationId, updatedAt: Date.now() }, { kind: "scope", _nodeId: String(request.taskId) }); });
		}) ?? EMPTY_CLEANUP;
	};

	const subscribeToPlaybackTasks = (): (() => void) => {
		if (!pageRuntime || !dktPort) return EMPTY_CLEANUP;
		return (
			pageRuntime.subscribeRuntimeTaskRequests?.(
				"$fx_applyPlaybackRun",
				(payload) => {
					const value =
						payload && typeof payload === "object"
							? (payload as {
									run?: PlaybackRun | null;
									committedCursor?: unknown;
								})
							: null;
					const committedCursor =
						typeof value?.committedCursor === "number"
							? value.committedCursor
							: playback.getSnapshot().presentationTime;
					playback.applyRun(value?.run ?? null, committedCursor);
				},
			) ?? EMPTY_CLEANUP
		);
	};

	const subscribeToCanonicalPlaybackCursor = (): (() => void) => {
		if (!pageRuntime) return EMPTY_CLEANUP;
		let disposeAttrs = EMPTY_CLEANUP;
		const attach = () => {
			disposeAttrs();
			const root = pageRuntime.getRootScope();
			if (!root) return;
			const sync = () => {
				const attrs = pageRuntime.readAttrs(root, ["cursor", "isPlaying"]);
				if (attrs.isPlaying === true || playback.getSnapshot().isScrubbing) return;
				playback.applyRun(
					null,
					typeof attrs.cursor === "number" ? attrs.cursor : 0,
				);
			};
			disposeAttrs = pageRuntime.subscribeAttrs(
				root,
				["cursor", "isPlaying"],
				sync,
			);
			sync();
		};
		const disposeRoot = pageRuntime.subscribeRootScope(attach);
		attach();
		return () => {
			disposeAttrs();
			disposeRoot();
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
	const unsubscribeMediaRecoveryTasks = subscribeToMediaRecoveryTasks();
	const unsubscribePlaybackTasks = subscribeToPlaybackTasks();
	const unsubscribeCanonicalPlaybackCursor =
		subscribeToCanonicalPlaybackCursor();
	const unsubscribeImportProgressRequests = subscribeToImportProgressRequests();

	return {
		// Only essential public API
		worker: authorityClient,
		pageRuntime,
		actions,
		resourceTransfers$: resourceTransferManager.transfers$,
		playback,
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
			await this.startMediaRecovery(resourceId, "locate-original");
		},

		requestResourceAccess(resourceId: string) {
			return localMediaResolver.requestResourceAccess(resourceId);
		},

		async startMediaRecovery(resourceId: string, intent: "locate-original" | "replace-source") {
			const picker = (globalThis as typeof globalThis & { showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker;
			if (typeof picker !== "function") return null;
			const [handle] = await picker({ multiple: false }).catch(() => []);
			if (!handle) return null;
			const resourceScope = readActiveProjectResourceScopes().find((scope) => scope._nodeId === resourceId);
			if (!resourceScope) return null;
			const file = await handle.getFile(); const operationId = crypto.randomUUID();
			const runtimeHandleId = runtimeTasks.putRuntimeRef({ file, handle });
			pageRuntime?.dispatch("startMediaRecovery", { operationId, attemptId: crypto.randomUUID(), bootId: `user:${crypto.randomUUID()}`, recoveryKind: intent, intent, runtimeHandleId, createdAt: Date.now(), updatedAt: Date.now() }, resourceScope);
			return { operationId };
		},

			destroy(): void {
			isDestroyed = true;
			runtimeTasks.clear();
			unsubscribe();
			unsubscribeDownloadBridge();
			unsubscribeRenderExportTasks();
			unsubscribeHandleInputFilesTasks();
			unsubscribeMediaRecoveryTasks();
			unsubscribePlaybackTasks();
			unsubscribeCanonicalPlaybackCursor();
			playback.dispose();
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
