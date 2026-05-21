import type {
	DomSyncTransportLike,
	DomSyncTransportViewLike,
} from "dkt/dom-sync/transport.js";
import { prepare as prepareAppRuntime } from "dkt/runtime/app/prepare.js";
import { makeDktCrdtIndexedDBStorage } from "dkt/crdt/storage/indexeddb.js";
import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { DktCRDTEngine } from "dkt-all/libs/provoda/crdt/index.js";
import { hookSessionRoot } from "dkt-all/libs/provoda/provoda/BrowseMap.js";
import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import { getModelById } from "dkt-all/libs/provoda/utils/getModelById.js";
import { MiniCutAppRoot } from "../../models/AppRoot";
import {
	sanitizeDktCrdtStoragePackage,
	sanitizeStorageValue,
} from "../crdt/sanitizeStoragePackage";
import type { DktCrdtTransport } from "../crdt/testRelayContracts";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import {
	openMiniCutWorkspaceStorage,
	stageMiniCutWorkspaceManifest,
	type MiniCutWorkspaceOpenResult,
} from "../storage/minicutWorkspaceManifest";
import { dumpWorkerAppState } from "./workerStateDump";
import {
	WORKSPACE_OPEN_STATUS,
	WORKSPACE_OPENING_STATE,
	WORKSPACE_EMPTY_INITIALIZED_STATE,
	getWorkspaceOpenFailureLabel,
	getWorkspaceOpenStatusLabel,
	type WorkspaceOpenState,
} from "./workspaceOpenState";

type RuntimeModelLike = {
	_node_id?: string | null;
	model_name?: string | null;
	_highway?: {
		model_data_schema?: Record<string, unknown> | null;
	};
	states?: Record<string, unknown>;
	__getPublicAttrs?: () => readonly string[];
	getLinedStructure?: (
		options: unknown,
		config: unknown,
	) => Promise<readonly RuntimeModelLike[]> | readonly RuntimeModelLike[];
	input?: (callback: () => void | Promise<void>) => unknown;
	queryRel?: (relName: string) => Promise<unknown> | unknown;
	dispatch: (
		actionName: string,
		payload?: unknown,
		options?: unknown,
		meta?: unknown,
	) => Promise<void> | void;
	start_page?: unknown;
};

export type MiniCutCrdtTransport = {
	send?: DktCrdtTransport["send"];
	subscribe?: DktCrdtTransport["subscribe"];
	close?: DktCrdtTransport["close"];
	attach?: (
		crdtRuntime: MiniCutCrdtRuntimeLike,
		context: {
			peerId: string;
			profileId: string;
			profileVersion: number;
			baseModel: RuntimeModelLike;
			sendToPage: (message: MiniCutDktTransportMessage) => void;
			subscribePageCrdtMessages: (
				listener: (message: unknown) => void,
			) => () => void;
		},
	) => undefined | (() => void);
};

type MiniCutCrdtRuntimeLike = {
	peer_id?: string;
	outbox?: unknown[];
	crdt_registry?: unknown;
	conflict_store?: {
		readConflicts: (filter?: unknown) => readonly {
			conflict_id?: unknown;
			[key: string]: unknown;
		}[];
	};
	receiveCanonicalOp?: (model: RuntimeModelLike, op: unknown) => unknown;
	receiveCanonicalOps?: (model: RuntimeModelLike, ops: unknown[]) => unknown;
	receiveCanonicalBatch?: (model: RuntimeModelLike, batch: unknown) => unknown;
	testing?: {
		drainOutbox?: () => unknown[];
		drainOutboxBatches?: () => unknown[];
		peekDurableLog?: () => unknown[];
		peekTransportTrace?: () => unknown[];
		receiveFromNetwork?: (
			model: RuntimeModelLike,
			message: unknown,
		) => unknown;
	};
	attachTransport?: (
		transport: DktCrdtTransport,
		options?: { baseModel?: RuntimeModelLike },
	) => unknown;
};

type MiniCutCrdtStoragePackage = {
	dktStorage: unknown;
	crdtStorage: unknown;
	commitChanges?: (meta?: unknown) => Promise<void> | void;
	whenReady?: () => Promise<void> | void;
	close?: () => Promise<void> | void;
};

type MiniCutCrdtStorageOptions =
	| "memory"
	| MiniCutCrdtStoragePackage
	| {
			type: "memory";
	  }
	| {
			type: "indexeddb";
			dbName: string;
			version?: number;
			indexedDB?: unknown;
	  };

type MaybePromise<T> = T | Promise<T>;

type MiniCutCrdtOptions =
	| false
	| true
	| {
			enabled: true;
			testOnly?: true;
			peerId?: string;
			profileId?: string;
			profileVersion?: number;
			storage?: MiniCutCrdtStorageOptions;
			peerIdForSession?: (sessionKey: string, sessionId: string) => MaybePromise<string>;
			peerIdForSessionKey?: (sessionKey: string) => MaybePromise<string>;
			defaultStorageDbNameForSessionKey?: (sessionKey: string) => string;
			workspaceIdForSessionKey?: (sessionKey: string) => string;
			transport?: MiniCutCrdtTransport | null;
			transportForSession?: (
				sessionKey: string,
				context: { peerId: string; profileId: string; profileVersion: number },
			) => MiniCutCrdtTransport | null;
		};

type CreateMiniCutDktRuntimeOptions = {
	enabled?: boolean;
	crdt?: MiniCutCrdtOptions;
	unloadModels?: boolean;
};

type RuntimeLike = {
	start(options: {
		App: typeof MiniCutAppRoot;
		interfaces: Record<string, unknown>;
	}): Promise<{ app_model: RuntimeModelLike }>;
	whenAllReady?: (fn: () => void) => void;
	sync_sender: {
		addSyncStream(
			root: RuntimeModelLike,
			stream: ReturnType<typeof createWorkerStream>,
			importantRelPaths: readonly (readonly string[])[],
		): Promise<void> | void;
		removeSyncStream(stream: ReturnType<typeof createWorkerStream>): void;
		updateStructureUsage(streamId: string, data: unknown): void;
		requireShapeForModel(streamId: string, data: unknown): void;
	};
	models?: Record<string, RuntimeModelLike>;
	model_data_schema?: Record<string, unknown>;
	crdt_runtime?: MiniCutCrdtRuntimeLike | null;
};

const getSyncShapeRequestNodeId = (data: unknown): string | null =>
	Array.isArray(data) && typeof data[0] === "string" ? data[0] : null;

const isStoragePackage = (
	value: MiniCutCrdtStorageOptions | undefined,
): value is MiniCutCrdtStoragePackage =>
	Boolean(
		value &&
			typeof value === "object" &&
			"dktStorage" in value &&
			"crdtStorage" in value,
	);

const createStoragePackage = async (
	storage: MiniCutCrdtStorageOptions | undefined,
): Promise<MiniCutCrdtStoragePackage> => {
	if (isStoragePackage(storage)) {
		return storage;
	}
	if (!storage || storage === "memory" || storage.type === "memory") {
		return makeDktCrdtMemoryStorage() as MiniCutCrdtStoragePackage;
	}
	if (storage.type === "indexeddb") {
		return sanitizeDktCrdtStoragePackage(
			(await makeDktCrdtIndexedDBStorage({
				dbName: storage.dbName,
				version: storage.version,
				indexedDB: storage.indexedDB,
			})) as MiniCutCrdtStoragePackage,
		);
	}
	throw new Error("Unsupported MiniCut CRDT storage option");
};

const normalizeCrdtOptions = (
	options: MiniCutCrdtOptions | undefined,
): Exclude<MiniCutCrdtOptions, false | true> | null => {
	if (options === true) {
		return { enabled: true };
	}
	if (!options || options.enabled !== true) {
		return null;
	}
	return options;
};

const defaultProductionCrdtStorage = (
	peerId: string,
): MiniCutCrdtStorageOptions => ({
	type: "indexeddb",
	dbName: `minicut-crdt-${peerId}`,
});

const createCrdtRuntime = async (
	options: MiniCutCrdtOptions | undefined,
	openPolicySessionKey = "minicut-local",
): Promise<{
	crdtRuntime: MiniCutCrdtRuntimeLike | null;
	storagePackage: MiniCutCrdtStoragePackage | null;
	peerId: string;
	profileId: string;
	profileVersion: number;
	transport: MiniCutCrdtTransport | null;
	storageOpen: MiniCutWorkspaceOpenResult | null;
	workspaceOpenState: WorkspaceOpenState | null;
}> => {
	const normalized = normalizeCrdtOptions(options);
	if (!normalized) {
		return {
			crdtRuntime: null,
			storagePackage: null,
			peerId: "minicut-local",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
			transport: null,
			storageOpen: null,
			workspaceOpenState: null,
		};
	}
	const peerId =
		normalized.peerId ??
		(normalized.testOnly === true ? "minicut-test-worker" : "minicut-browser");
	const profileId = normalized.profileId ?? "minicut-crdt-v1";
	const profileVersion = normalized.profileVersion ?? 1;
	const transport =
		normalized.transportForSession?.(openPolicySessionKey, {
			peerId,
			profileId,
			profileVersion,
		}) ??
		normalized.transport ??
		null;
	const storagePackage = await createStoragePackage(
		normalized.storage ??
			(normalized.testOnly === true
				? "memory"
				: defaultProductionCrdtStorage(peerId)),
	);
	const workspaceId = normalized.workspaceIdForSessionKey?.(openPolicySessionKey);
	const storageOpen = workspaceId
		? await openMiniCutWorkspaceStorage({
				storage: storagePackage.dktStorage,
				workspaceId,
			})
		: null;
	if (
		storageOpen?.ok === true &&
		storageOpen.status === WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED &&
		workspaceId
	) {
		const stagedManifest = stageMiniCutWorkspaceManifest({
			storage: storagePackage.dktStorage,
			workspaceId,
		});
		if (stagedManifest) {
			storageOpen.dktManifest = stagedManifest;
		}
	}
	return {
		crdtRuntime: new DktCRDTEngine({
			peer_id: peerId,
			storage: storagePackage.crdtStorage,
			profile_id: profileId,
			profile_version: profileVersion,
			...(transport?.send && transport.subscribe
				? { transport }
				: null),
		}) as MiniCutCrdtRuntimeLike,
		storagePackage,
		peerId,
		profileId,
		profileVersion,
		transport,
		storageOpen,
		workspaceOpenState: storageOpen?.openState ?? null,
	};
};

const createCrdtRuntimeForSession = async (
	options: MiniCutCrdtOptions | undefined,
	sessionKey: string,
	sessionId = sessionKey,
): ReturnType<typeof createCrdtRuntime> => {
	const normalized = normalizeCrdtOptions(options);
	if (
		!normalized ||
		normalized.storage ||
		normalized.testOnly === true ||
		typeof normalized.defaultStorageDbNameForSessionKey !== "function"
	) {
		return createCrdtRuntime(options, sessionKey);
	}

	const peerId =
		typeof normalized.peerIdForSession === "function"
			? await normalized.peerIdForSession(sessionKey, sessionId)
			: typeof normalized.peerIdForSessionKey === "function"
			? await normalized.peerIdForSessionKey(sessionKey)
			: normalized.peerId;

	return createCrdtRuntime(
		{
			...normalized,
			peerId,
			storage: {
				type: "indexeddb",
				dbName: normalized.defaultStorageDbNameForSessionKey(sessionKey),
			},
		},
		sessionKey,
	);
};

const stripAggregateSchema = (payload: unknown): unknown => {
	if (Array.isArray(payload)) {
		return payload.map(stripAggregateSchema);
	}
	if (!payload || typeof payload !== "object") {
		return payload;
	}
	if (!Object.hasOwn(payload, "$aggregates")) {
		return payload;
	}
	const sanitizedSchema = { ...(payload as Record<string, unknown>) };
	delete sanitizedSchema.$aggregates;
	return sanitizedSchema;
};

const createWorkerStream = (
	transport: DomSyncTransportViewLike<MiniCutDktTransportMessage>,
	sessionKey: string,
) => ({
	id: `minicut-stream-${Math.random().toString(36).slice(2)}`,
	sessionKey,
	send(list: unknown[]) {
		transport.send({
			type: DKT_MSG.SYNC_HANDLE,
			syncType: SYNCR_TYPES.UPDATE,
			payload: list.slice(),
		});
	},
	sendDict(dict: unknown[]) {
		transport.send({
			type: DKT_MSG.SYNC_HANDLE,
			syncType: SYNCR_TYPES.SET_DICT,
			payload: dict.slice(),
		});
	},
	sendWithType(syncType: number, payload: unknown) {
		const outgoingPayload =
			syncType === SYNCR_TYPES.SET_MODEL_SCHEMA
				? stripAggregateSchema(payload)
				: payload;
		transport.send({
			type: DKT_MSG.SYNC_HANDLE,
			syncType,
			payload: outgoingPayload,
		});
	},
});

const SESSION_IMPORTANT_REL_PATHS = Object.freeze([
	Object.freeze(["pioneer"]),
	Object.freeze(["activeProject"]),
	Object.freeze(["selectedClip"]),
	Object.freeze(["pioneer", "project"]),
	Object.freeze(["pioneer", "project", "tracks"]),
	Object.freeze(["pioneer", "project", "resources"]),
	Object.freeze(["pioneer", "project", "tracks", "clips"]),
	Object.freeze(["pioneer", "project", "tracks", "clips", "resource"]),
	Object.freeze(["pioneer", "project", "tracks", "clips", "text"]),
	Object.freeze(["pioneer", "project", "tracks", "clips", "effects"]),
	Object.freeze(["activeProject", "tracks"]),
	Object.freeze(["activeProject", "resources"]),
	Object.freeze(["activeProject", "tracks", "clips"]),
	Object.freeze(["activeProject", "tracks", "clips", "resource"]),
	Object.freeze(["activeProject", "tracks", "clips", "text"]),
	Object.freeze(["activeProject", "tracks", "clips", "effects"]),
	Object.freeze(["pioneer", "effect"]),
]);

const crdtResolutionAttemptMeta = (
	actionName: string,
	payload: unknown,
	target: RuntimeModelLike,
): Record<string, unknown> | null => {
	if (actionName !== "resolveClipTimingConflict") {
		return null;
	}
	const conflictId =
		payload && typeof payload === "object"
			? ((payload as { conflict_id?: unknown; conflictId?: unknown }).conflict_id ??
				(payload as { conflictId?: unknown }).conflictId)
			: null;
	if (typeof conflictId !== "string" || conflictId.length === 0) {
		return null;
	}
	return {
		crdt_resolution_attempt: {
			conflict_id: conflictId,
			aggregate: "clipTiming",
			model_id: target._node_id ?? null,
			model_name: target.model_name ?? null,
		},
	};
};

export const createMiniCutDktRuntime = (
	options: CreateMiniCutDktRuntimeOptions = {},
) => {
	let crdtPromise: ReturnType<typeof createCrdtRuntime> | null = null;
	let crdtTransportCleanup: (() => void) | null = null;
	let bootPromise: Promise<{
		runtime: RuntimeLike;
		appModel: RuntimeModelLike;
	}> | null = null;
	const sessionRootPromises = new Map<string, Promise<RuntimeModelLike>>();
	const activeTransports = new Set<
		DomSyncTransportLike<MiniCutDktTransportMessage>
	>();
	const pageCrdtMessageListeners = new Set<(message: unknown) => void>();
	const enabled = options.enabled === true;
	let lastWorkspaceOpenState: WorkspaceOpenState | null = WORKSPACE_OPENING_STATE;
	let lastRuntimeErrorMessage: string | null = null;

	const publishWorkspaceOpenState = (
		state: WorkspaceOpenState,
		message?: string,
	): void => {
		lastWorkspaceOpenState = state;
		for (const transport of activeTransports) {
			transport.send({
				type: DKT_MSG.WORKSPACE_OPEN_STATE,
				state,
				statusLabel: getWorkspaceOpenStatusLabel(state.status),
				failureReasonLabel: getWorkspaceOpenFailureLabel(state.failureReason),
				...(message ? { message } : null),
			});
		}
	};

	const formatWorkspaceOpenError = (
		storageOpen: Extract<MiniCutWorkspaceOpenResult, { ok: false }>,
	): string =>
		`CRDT harness storage open failed: ${storageOpen.failureReasonLabel.replace(
			/_/g,
			" ",
		)}`;

	const logRuntime = (message: string, details?: unknown) => {
		for (const transport of activeTransports) {
			transport.send({
				type: DKT_MSG.RUNTIME_LOG,
				message: { channel: "export-request", message, details },
			});
		}
		if (
			(globalThis as { __MINICUT_EXPORT_DEBUG__?: unknown })
				.__MINICUT_EXPORT_DEBUG__ === true
		) {
			console.info("[minicut:dkt-worker:export]", message, details);
		}
	};

	const publishExportRequest = (payload: unknown) => {
		const requestPayload =
			payload && typeof payload === "object"
				? ((payload as { request?: unknown }).request ?? payload)
				: payload;
		const requestId = (requestPayload as { id?: unknown } | null)?.id;
		logRuntime("publishExportRequest:attempt", {
			requestId,
			transports: activeTransports.size,
		});

		for (const transport of activeTransports) {
			transport.send({
				type: DKT_MSG.EXPORT_REQUEST,
				payload,
			});
		}
		logRuntime("publishExportRequest:sent", {
			requestId,
			transports: activeTransports.size,
		});
	};

	const publishImportFilesRequest = (payload: unknown) => {
		for (const transport of activeTransports) {
			transport.send({
				type: DKT_MSG.IMPORT_FILES_REQUEST,
				payload,
			});
		}
	};

	const clearExportProgressInAllSessions = async () => {
		logRuntime("clearExportProgressInAllSessions:start", {
			sessionCount: sessionRootPromises.size,
		});
		for (const [sessionKey, _sessionRootPromise] of sessionRootPromises) {
			try {
				await dispatchScopedAction("clearExportProgress", {}, null, sessionKey);
				logRuntime("clearExportProgressInAllSessions:cleared", { sessionKey });
			} catch (error) {
				logRuntime("clearExportProgressInAllSessions:error", {
					sessionKey,
					error: String(error),
				});
			}
		}
	};

	const bootstrapApp = async (
		sessionKey = "minicut-local",
		sessionId = sessionKey,
	) => {
		if (!enabled) {
			return null;
		}

		if (!bootPromise) {
			bootPromise = (async () => {
				crdtPromise = createCrdtRuntimeForSession(
					options.crdt,
					sessionKey,
					sessionId,
				);
				const crdt = await crdtPromise;
				if (crdt.workspaceOpenState) {
					publishWorkspaceOpenState(crdt.workspaceOpenState);
				}
				if (crdt.storageOpen?.ok === false) {
					const message = formatWorkspaceOpenError(crdt.storageOpen);
					lastRuntimeErrorMessage = message;
					publishWorkspaceOpenState(crdt.storageOpen.openState, message);
					throw new Error(message);
				}
				lastRuntimeErrorMessage = null;
				const runtime = prepareAppRuntime({
					sync_sender: true,
					warnUnexpectedAttrs: true,
					unload_models: options.unloadModels === true,
					...(crdt.crdtRuntime ? { crdtRuntime: crdt.crdtRuntime } : null),
					...(crdt.storagePackage
						? { dkt_storage: crdt.storagePackage.dktStorage }
						: null),
					onError(error: unknown) {
						for (const transport of activeTransports) {
							transport.send({
								type: DKT_MSG.RUNTIME_ERROR,
								message:
									error instanceof Error
										? error.stack || error.message
										: String(error),
							});
						}
					},
				}) as RuntimeLike;
				const inited = await runtime.start({
					App: MiniCutAppRoot,
					interfaces: {
						time: {
							setTimeout: globalThis.setTimeout.bind(globalThis),
							clearTimeout: globalThis.clearTimeout.bind(globalThis),
							Date: globalThis.Date,
						},
						exportRuntime: {
							requestExport: (payload: unknown) => {
								const requestPayload =
									payload && typeof payload === "object"
										? ((payload as { request?: unknown }).request ?? payload)
										: payload;
								logRuntime("exportRuntime.requestExport", {
									requestId: (requestPayload as { id?: unknown } | null)?.id,
								});
								publishExportRequest(payload);
							},
						},
						importRuntime: {
							requestImportFiles: (payload: unknown) => {
								publishImportFilesRequest(payload);
							},
						},
					},
				});
				if (
					crdt.crdtRuntime &&
					crdt.transport?.attach &&
					!(crdt.transport.send && crdt.transport.subscribe)
				) {
					const cleanup = crdt.transport.attach(crdt.crdtRuntime, {
						peerId: crdt.peerId,
						profileId: crdt.profileId,
						profileVersion: crdt.profileVersion,
						baseModel: inited.app_model,
						sendToPage: (message) => {
							for (const transport of activeTransports) {
								transport.send(message);
							}
						},
						subscribePageCrdtMessages: (listener) => {
							pageCrdtMessageListeners.add(listener);
							return () => pageCrdtMessageListeners.delete(listener);
						},
					});
					if (typeof cleanup === "function") {
						crdtTransportCleanup = cleanup;
					}
				}
				return { runtime, appModel: inited.app_model };
			})();
		}

		return bootPromise;
	};

	const bootstrapSessionRoot = async (
		sessionKey = "minicut-local",
		sessionId?: string | null,
	): Promise<RuntimeModelLike | null> => {
		const app = await bootstrapApp(sessionKey, sessionId ?? sessionKey);
		if (!app) {
			return null;
		}

		const resolvedSessionId = sessionId || sessionKey;
		const cached = sessionRootPromises.get(resolvedSessionId);
		if (cached) {
			return cached;
		}

		const sessionRootPromise = new Promise<RuntimeModelLike>(
			(resolve, reject) => {
				const createSessionRoot = async () => {
					try {
						const crdt = crdtPromise ? await crdtPromise : null;
						const storageOpenStatus =
							crdt?.workspaceOpenState?.status ??
							WORKSPACE_EMPTY_INITIALIZED_STATE.status;
						const sessionRoot = await hookSessionRoot(
							app.appModel,
							app.appModel.start_page,
							{
								sessionKey: resolvedSessionId,
								route: null,
								storageOpenStatus,
							},
						);
						resolve(sessionRoot as RuntimeModelLike);
					} catch (error) {
						reject(error);
					}
				};

				if (typeof app.appModel.input === "function") {
					app.appModel.input(createSessionRoot);
					return;
				}

				createSessionRoot();
			},
		);

		sessionRootPromises.set(resolvedSessionId, sessionRootPromise);

		return sessionRootPromise;
	};

	const dispatchScopedAction = async (
		actionName: string,
		payload?: unknown,
		scopeNodeId?: string | null,
		sessionKey = "minicut-local",
		sessionId?: string | null,
		meta?: unknown,
	): Promise<void> => {
		const sessionRoot = await bootstrapSessionRoot(sessionKey, sessionId);
		if (!sessionRoot) {
			throw new Error("MiniCut DKT runtime is disabled");
		}

		let target = sessionRoot;
		if (typeof scopeNodeId === "string" && scopeNodeId) {
			const scopedTarget = getModelById(
				sessionRoot,
				scopeNodeId,
			) as RuntimeModelLike | null;
			if (!scopedTarget) {
				throw new Error(`MiniCut DKT scope was not found: ${scopeNodeId}`);
			}

			target = scopedTarget;
		}

		const resolutionMeta = crdtResolutionAttemptMeta(actionName, payload, target);
		// DKT dispatch is event-log scheduling: it enqueues an action flow step
		// and intentionally does not expose a completion promise here.
		target.dispatch(actionName, payload, null, resolutionMeta ?? meta);
	};

	const connect = (
		transport: DomSyncTransportLike<MiniCutDktTransportMessage>,
	) => {
		let destroyed = false;
		let stream: ReturnType<typeof createWorkerStream> | null = null;
		let activeSessionKey = "minicut-local";
		let activeSessionId = "minicut-local";
		let messageQueue = Promise.resolve();
		activeTransports.add(transport);

		const sendError = (error: unknown, requestId?: string): void => {
			transport.send({
				type: DKT_MSG.RUNTIME_ERROR,
				requestId,
				message:
					error instanceof Error ? error.stack || error.message : String(error),
			});
		};

		const bootstrap = async (
			requestId?: string,
			sessionKey?: string,
			sessionId?: string,
		): Promise<void> => {
			const nextSessionKey = sessionKey || "minicut-local";
			const nextSessionId = sessionId || nextSessionKey;
			activeSessionKey = nextSessionKey;
			activeSessionId = nextSessionId;
			const app = await bootstrapApp(activeSessionKey, activeSessionId);
			if (!app) {
				throw new Error("MiniCut DKT runtime is disabled");
			}
			const sessionRoot = await bootstrapSessionRoot(
				activeSessionKey,
				activeSessionId,
			);
			if (!sessionRoot) {
				throw new Error("MiniCut DKT session root is not available");
			}

			// Recreate the sync stream if the sessionKey changed (e.g. after failover reconnect
			// or if a premature BOOTSTRAP previously locked the stream to the wrong session).
			if (stream && stream.sessionKey !== activeSessionId) {
				app.runtime.sync_sender.removeSyncStream(stream);
				stream = null;
			}
			if (!stream) {
				stream = createWorkerStream(transport, activeSessionId);
				const sanitizedSchema = stripAggregateSchema(
					app.runtime.model_data_schema,
				) as Record<string, unknown> | undefined;
				const originalSyncSchema = sessionRoot._highway?.model_data_schema;
				if (sessionRoot._highway && sanitizedSchema) {
					sessionRoot._highway.model_data_schema = sanitizedSchema;
				}
				try {
					await app.runtime.sync_sender.addSyncStream(
						sessionRoot,
						stream,
						SESSION_IMPORTANT_REL_PATHS,
					);
				} finally {
					if (sessionRoot._highway) {
						sessionRoot._highway.model_data_schema =
							originalSyncSchema ?? app.runtime.model_data_schema ?? null;
					}
				}
			}

			transport.send({
				type: DKT_MSG.RUNTIME_READY,
				requestId,
				sessionId: activeSessionId,
				sessionKey: activeSessionKey,
				rootNodeId: sessionRoot._node_id ?? null,
			});
		};

		const handleMessage = async (
			message: MiniCutDktTransportMessage,
		): Promise<void> => {
			if (destroyed) {
				return;
			}

			switch (message.type) {
				case DKT_MSG.BOOTSTRAP:
					await bootstrap(undefined, message.sessionKey, message.sessionId);
					return;
				case DKT_MSG.WAIT_IDLE: {
					const app = await bootstrapApp();
					if (!app) {
						transport.send({
							type: DKT_MSG.IDLE,
							requestId: message.requestId,
						});
						return;
					}

					await new Promise<void>((resolve) => {
						if (typeof app.appModel.input === "function") {
							app.appModel.input?.(() => resolve());
							return;
						}

						if (typeof app.runtime.whenAllReady === "function") {
							app.runtime.whenAllReady(() => resolve());
							return;
						}

						resolve();
					});

					transport.send({ type: DKT_MSG.IDLE, requestId: message.requestId });
					return;
				}
				case DKT_MSG.CLOSE_SESSION:
					destroy();
					return;
				case DKT_MSG.DISPATCH_ACTION:
					if (
						message.actionName === "requestProjectExport" ||
						message.actionName === "requestSelectedClipExport" ||
						message.actionName === "requestClipExport"
					) {
						logRuntime("dispatch export action", {
							actionName: message.actionName,
							requestId: (message.payload as { id?: unknown } | null)?.id,
							scopeNodeId: message.scopeNodeId ?? null,
						});
					}
					await dispatchScopedAction(
						message.actionName,
						message.payload,
						message.scopeNodeId,
						activeSessionKey,
						activeSessionId,
						message.meta,
					);
					if (message.requestId) {
						transport.send({
							type: DKT_MSG.RUNTIME_READY,
							requestId: message.requestId,
							sessionId: activeSessionId,
							sessionKey: activeSessionKey,
							rootNodeId: null,
						});
					}
					return;
				case DKT_MSG.SYNC_UPDATE_STRUCTURE_USAGE: {
					const app = await bootstrapApp();
					if (!app || !stream) {
						throw new Error("MiniCut DKT sync stream is not bootstrapped");
					}
					app.runtime.sync_sender.updateStructureUsage(stream.id, message.data);
					return;
				}
				case DKT_MSG.SYNC_REQUIRE_SHAPE: {
					const app = await bootstrapApp();
					if (!app || !stream) {
						throw new Error("MiniCut DKT sync stream is not bootstrapped");
					}
					const nodeId = getSyncShapeRequestNodeId(message.data);
					if (nodeId && !app.runtime.models?.[nodeId]) {
						logRuntime("ignore shape request for unknown model", {
							nodeId,
							sessionKey: activeSessionKey,
						});
						return;
					}
					app.runtime.sync_sender.requireShapeForModel(stream.id, message.data);
					return;
				}
				case DKT_MSG.DEBUG_DUMP_REQUEST: {
					const summary = await debugDumpState(activeSessionKey);
					const app = await bootstrapApp(activeSessionKey);
					if (!app) {
						transport.send({
							type: DKT_MSG.DEBUG_DUMP_RESPONSE,
							dump: summary,
						});
						return;
					}
					const dump = await dumpWorkerAppState(
						app.appModel,
						app.runtime.models ?? {},
					);
					transport.send({
						type: DKT_MSG.DEBUG_DUMP_RESPONSE,
						dump: sanitizeStorageValue({ ...dump, ...summary }),
					});
					return;
				}
				case DKT_MSG.CRDT_TRANSPORT_RECEIVE: {
					for (const listener of [...pageCrdtMessageListeners]) {
						listener(message.message);
					}
					return;
				}
			}
		};

		const unlisten = transport.listen((message: MiniCutDktTransportMessage) => {
			messageQueue = messageQueue
				.then(() => handleMessage(message))
				.catch((error) =>
					sendError(
						error,
						"requestId" in message ? message.requestId : undefined,
					),
				);
		});

		// Subscribe to disconnect event and clear export progress
		const unlistenDisconnect =
			transport.onDisconnect?.(() => {
				logRuntime("transport:onDisconnect", { activeSessionKey });
				void clearExportProgressInAllSessions();
			}) ?? (() => {});

		const destroy = (): void => {
			if (destroyed) {
				return;
			}
			destroyed = true;
			activeTransports.delete(transport);
			unlisten();
			unlistenDisconnect();
			const shouldCloseSharedCrdt = activeTransports.size === 0;
			if (shouldCloseSharedCrdt) {
				crdtTransportCleanup?.();
				crdtTransportCleanup = null;
			}
			void Promise.resolve()
				.then(() => bootstrapApp(activeSessionKey))
				.catch(() => null)
				.then((app) => {
					if (app && stream) {
						app.runtime.sync_sender.removeSyncStream(stream);
					}
				})
				.then(async () => {
					if (shouldCloseSharedCrdt && activeTransports.size === 0) {
						const crdt = crdtPromise ? await crdtPromise : null;
						await crdt?.storagePackage?.close?.();
					}
				})
				.finally(() => {
					stream = null;
					transport.destroy();
				});
		};

		return { destroy };
	};

	const debugDumpState = async (sessionKey = "minicut-local") => {
		let app: Awaited<ReturnType<typeof bootstrapApp>> | null = null;
		try {
			app = await bootstrapApp(sessionKey);
		} catch (error) {
			lastRuntimeErrorMessage =
				lastRuntimeErrorMessage ??
				(error instanceof Error ? error.message : String(error));
			const crdt = crdtPromise ? await crdtPromise.catch(() => null) : null;
			return {
				enabled,
				booted: false,
				sessions: [...sessionRootPromises.keys()],
				modelsCount: 0,
				workspaceOpenState: lastWorkspaceOpenState,
				runtimeError: lastRuntimeErrorMessage,
				crdt: crdt?.storageOpen
					? {
							enabled: Boolean(crdt.crdtRuntime),
							peerId: crdt.peerId,
							profileId: crdt.profileId,
							profileVersion: crdt.profileVersion,
							storageOpen: crdt.storageOpen,
						}
					: { enabled: false },
			};
		}
		if (!app) {
			return {
				enabled,
				booted: false,
				sessions: [...sessionRootPromises.keys()],
				modelsCount: 0,
				workspaceOpenState: lastWorkspaceOpenState,
				runtimeError: lastRuntimeErrorMessage,
				crdt: { enabled: false },
			};
		}
		const crdt = crdtPromise
			? await crdtPromise
			: await createCrdtRuntime(options.crdt);
		const durableLog = app.runtime.crdt_runtime?.testing?.peekDurableLog?.();

		return {
			enabled,
			booted: true,
			sessions: [...sessionRootPromises.keys()],
			modelsCount: Object.keys(app.runtime.models ?? {}).length,
			rootNodeId: app.appModel._node_id ?? null,
			workerState: await dumpWorkerAppState(
				app.appModel,
				app.runtime.models ?? {},
			),
			workspaceOpenState: lastWorkspaceOpenState,
			runtimeError: lastRuntimeErrorMessage,
			flowWriteTrace: app.runtime.debug_flow_write_trace ?? [],
			crdt: app.runtime.crdt_runtime
				? {
						enabled: true,
						peerId: app.runtime.crdt_runtime.peer_id ?? crdt.peerId,
						profileId: crdt.profileId,
						profileVersion: crdt.profileVersion,
						outboxCount: app.runtime.crdt_runtime.outbox?.length ?? 0,
						durableLogCount: durableLog?.length ?? 0,
						transportTrace:
							app.runtime.crdt_runtime?.testing?.peekTransportTrace?.() ?? [],
						hasRegistry: Boolean(app.runtime.crdt_runtime.crdt_registry),
						storageOpen: crdt.storageOpen,
					}
				: { enabled: false },
		};
	};

	return { connect, debugDumpState };
};
