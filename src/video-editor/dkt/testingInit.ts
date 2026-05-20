/**
 * DKT-model test helper for MiniCut.
 *
 * Usage:
 *   const { appModel, sessionRoot, computed, lockToRead, queryRel, getAttr } = await bootDktModels()
 *
 * Follows the pattern from Linkcraft dkt/test/testingInit.js:
 *   - prepareAppRuntime + runtime.start
 *   - computed: uses flow.whenReady() to wait for DKT graph settle
 *   - lockToRead: dispatch + wait for settle (guarantees ordering)
 */

import { queryAttr as queryDktAttr } from "dkt/async/queryAttr.js";
import { queryRel as queryDktRel } from "dkt/async/queryRel.js";
import { makeDktCrdtIndexedDBStorage } from "dkt/crdt/storage/indexeddb.js";
import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { prepare as prepareAppRuntime } from "dkt/runtime/app/prepare.js";
import { reinit } from "dkt/runtime/app/reinit.js";
import { DktCRDTEngine } from "dkt-all/libs/provoda/crdt/index.js";
import { hookSessionRoot } from "dkt-all/libs/provoda/provoda/BrowseMap.js";
import { MiniCutAppRoot } from "../models/AppRoot";
import { sanitizeDktCrdtStoragePackage } from "./crdt/sanitizeStoragePackage";
import type { DktCrdtTransport } from "./crdt/testRelayContracts";
import {
	WORKSPACE_EMPTY_INITIALIZED_STATE,
	WORKSPACE_OPEN_STATUS,
} from "./runtime/workspaceOpenState";
import {
	type MiniCutWorkspaceOpenResult,
	openMiniCutWorkspaceStorage,
	stageMiniCutWorkspaceManifest,
} from "./storage/minicutWorkspaceManifest";

type AnyModel = {
	_node_id?: string | null;
	model_name?: string | null;
	states?: Record<string, unknown>;
	getAttr: (name: string) => unknown;
	getNesting: (name: string) => unknown;
	input?: (callback: () => void | Promise<void>) => unknown;
	app?: AnyModel;
	whenReady?: (fn?: () => void) => Promise<void> | void;
	queryRel?: (relName: string) => Promise<unknown> | unknown;
	queryAttr?: (attrName: string) => Promise<unknown> | unknown;
	dispatch: (
		actionName: string,
		payload?: unknown,
		options?: unknown,
		meta?: unknown,
	) => Promise<void> | void;
	start_page?: unknown;
};

type RuntimeWithCallsFlow = {
	calls_flow?: AnyModel;
	whenAllReady?: (fn: () => void) => void;
	input?: (fn: () => void | Promise<void>) => unknown;
	last_error?: Promise<unknown>;
};

type RuntimeStartResult = {
	app_model: AnyModel;
	flow?: AnyModel;
};

export type MiniCutDktCrdtRuntime = {
	peer_id?: string;
	outbox?: unknown[];
	crdt_registry?: unknown;
	conflict_store?: {
		readConflicts: (filter?: unknown) => readonly {
			conflict_id?: unknown;
			[key: string]: unknown;
		}[];
	};
	receiveCanonicalOp?: (model: AnyModel, op: unknown) => unknown;
	receiveCanonicalOps?: (model: AnyModel, ops: unknown[]) => unknown;
	receiveCanonicalBatch?: (model: AnyModel, batch: unknown) => unknown;
	testing?: {
		drainOutbox?: () => unknown[];
		drainOutboxBatches?: () => unknown[];
		peekDurableLog?: () => unknown[];
		receiveFromNetwork?: (model: AnyModel, message: unknown) => unknown;
	};
	restoreFromStorage?: () => Promise<void> | void;
	projectCRDTMeta?: (model: AnyModel) => Promise<void> | void;
	transport_receive_tail?: Promise<unknown>;
	flushTransportOutbox?: () => unknown;
	attachTransport?: (
		transport: DktCrdtTransport,
		options: { baseModel: AnyModel },
	) => void;
};

export type MiniCutDktCrdtStoragePackage = {
	dktStorage: unknown;
	crdtStorage: unknown;
	commitChanges?: (meta?: unknown) => Promise<void> | void;
	whenReady?: () => Promise<void> | void;
	close?: () => Promise<void> | void;
};

export type MiniCutDktCrdtStorageOptions =
	| "memory"
	| MiniCutDktCrdtStoragePackage
	| {
			type: "memory";
	  }
	| {
			type: "indexeddb";
			dbName: string;
			version?: number;
			indexedDB?: unknown;
	  };

type FlowErrorsCatcher = {
	last_error_prom: Promise<unknown>;
	reject_error_prom: (err: unknown) => void;
};

const catchFlowErrors = (): FlowErrorsCatcher => {
	let rejectCurrent: (err: unknown) => void = () => {};

	const makePromise = (): Promise<unknown> =>
		new Promise((_resolve, reject) => {
			rejectCurrent = (err: unknown) => {
				reject(err);
				catcher.last_error_prom = makePromise();
			};
		});

	const catcher = {
		last_error_prom: Promise.resolve() as Promise<unknown>,
		reject_error_prom: (err: unknown) => rejectCurrent(err),
	};

	catcher.last_error_prom = makePromise();

	return catcher;
};

const neverPromise = (): Promise<never> => new Promise<never>(() => {});

const toError = (value: unknown): Error =>
	value instanceof Error ? value : new Error(String(value));

const raceWithProcessErrors = async <Value>(
	promises: Promise<Value>[],
): Promise<Value> => {
	let cleanup = () => {};
	const processError = new Promise<never>((_resolve, reject) => {
		const onUnhandledRejection = (reason: unknown) => {
			cleanup();
			reject(toError(reason));
		};
		const onUncaughtException = (error: unknown) => {
			cleanup();
			reject(toError(error));
		};

		cleanup = () => {
			process.off("unhandledRejection", onUnhandledRejection);
			process.off("uncaughtException", onUncaughtException);
		};

		process.once("unhandledRejection", onUnhandledRejection);
		process.once("uncaughtException", onUncaughtException);
	});

	try {
		return await Promise.race([...promises, processError]);
	} finally {
		cleanup();
	}
};

/**
 * Query a rel on a model. Returns [] when rel is empty/null.
 */
export const queryRel = async (
	model: AnyModel | null | undefined,
	relName: string,
): Promise<AnyModel[]> => {
	if (!model) return [];
	const read = async () => await queryDktRel(model, relName);
	const isInsideTransaction =
		typeof model._highway?.getCurrentStateTransaction === "function" &&
		model._highway.getCurrentStateTransaction(false) != null;
	const inputRoot = model.app ?? model;
	const result =
		!isInsideTransaction && typeof inputRoot.input === "function"
			? await new Promise<unknown>((resolve, reject) => {
					inputRoot.input?.(async () => {
						try {
							const value = await read();
							resolve(value);
						} catch (error) {
							reject(error);
						}
					});
				})
			: await read();
	if (Array.isArray(result)) return result.filter(Boolean) as AnyModel[];
	if (result && typeof result === "object" && "_node_id" in result)
		return [result as AnyModel];
	return [];
};

/**
 * Read a reactive attr through DKT query boundary.
 * Use this in unload/lazy tests; sync state reads are only valid while the model is loaded.
 */
export const queryAttr = async (
	model: AnyModel | null | undefined,
	attrName: string,
): Promise<unknown> => {
	if (!model) return null;
	const read = async () => (await queryDktAttr(model, attrName)) ?? null;
	const isInsideTransaction =
		typeof model._highway?.getCurrentStateTransaction === "function" &&
		model._highway.getCurrentStateTransaction(false) != null;
	const inputRoot = model.app ?? model;
	return !isInsideTransaction && typeof inputRoot.input === "function"
		? await new Promise<unknown>((resolve, reject) => {
				inputRoot.input?.(async () => {
					try {
						const value = await read();
						resolve(value);
					} catch (error) {
						reject(error);
					}
				});
			})
		: await read();
};

/**
 * Read a reactive attr from a loaded model.
 * Missing attrs are normalized to null to match DKT default-state reads.
 */
export const getAttr = (
	model: AnyModel | null | undefined,
	attrName: string,
): unknown => model?.states?.[attrName] ?? null;

/**
 * Find a model in a flat root rel by a named attr value.
 */
export const findByAttr = async (
	rootModel: AnyModel,
	rootRelName: string,
	attrName: string,
	attrValue: unknown,
): Promise<AnyModel | undefined> => {
	const models = await queryRel(rootModel, rootRelName);
	return models.find((m) => getAttr(m, attrName) === attrValue);
};

export type DktTestContext = {
	appModel: AnyModel;
	sessionRoot: AnyModel;
	runtime: RuntimeWithCallsFlow & {
		crdt_runtime?: MiniCutDktCrdtRuntime | null;
		applyExternalGraphPatch?: (
			patch: unknown,
			meta?: unknown,
			options?: unknown,
		) => Promise<unknown> | unknown;
		graph_semantics?: { inverseValidation?: "off" | "warn" | "error" };
	};
	computed: () => Promise<void>;
	/**
	 * Run a dispatch inside app_model.input() and wait for settle.
	 * Use this for all dispatches in tests to guarantee ordering.
	 */
	lockToRead: (fn: () => void | Promise<void>) => Promise<void>;
	queryRel: typeof queryRel;
	queryAttr: typeof queryAttr;
	getAttr: typeof getAttr;
	findByAttr: typeof findByAttr;
	storagePackage: MiniCutDktCrdtStoragePackage | null;
	crdtStorageOpen: MiniCutWorkspaceOpenResult | null;
	close: () => Promise<void>;
};

const TEST_SESSION_KEY = "test-session";

export type BootDktModelsOptions = {
	interfaces?: Record<string, unknown>;
	reinitFromSnapshot?: unknown;
	graphSemantics?: {
		inverseValidation?: "off" | "warn" | "error";
	};
	aggregateValidation?: "error" | "warn" | "off";
	unloadModels?: boolean;
	crdt?:
		| false
		| {
				enabled: true;
				peerId?: string;
				profileId?: string;
				profileVersion?: number;
				storage?: MiniCutDktCrdtStorageOptions;
				workspaceId?: string;
				workspaceIdForSessionKey?: (sessionKey: string) => string;
				transport?: DktCrdtTransport | null;
		  };
};

const isStoragePackage = (
	value: MiniCutDktCrdtStorageOptions | undefined,
): value is MiniCutDktCrdtStoragePackage =>
	Boolean(
		value &&
			typeof value === "object" &&
			"dktStorage" in value &&
			"crdtStorage" in value,
	);

const createStoragePackage = async (
	storage: MiniCutDktCrdtStorageOptions | undefined,
): Promise<MiniCutDktCrdtStoragePackage> => {
	if (isStoragePackage(storage)) {
		return storage;
	}
	if (!storage || storage === "memory" || storage.type === "memory") {
		return makeDktCrdtMemoryStorage() as MiniCutDktCrdtStoragePackage;
	}
	if (storage.type === "indexeddb") {
		return sanitizeDktCrdtStoragePackage(
			(await makeDktCrdtIndexedDBStorage({
				dbName: storage.dbName,
				version: storage.version,
				indexedDB: storage.indexedDB,
			})) as MiniCutDktCrdtStoragePackage,
		);
	}
	throw new Error("Unsupported MiniCut CRDT storage option");
};

const createCrdtRuntimeForTests = async (
	options: BootDktModelsOptions["crdt"],
): Promise<{
	crdtRuntime: MiniCutDktCrdtRuntime | null;
	storagePackage: MiniCutDktCrdtStoragePackage | null;
	storageOpen: MiniCutWorkspaceOpenResult | null;
	transport: DktCrdtTransport | null;
}> => {
	if (!options || options.enabled !== true) {
		return {
			crdtRuntime: null,
			storagePackage: null,
			storageOpen: null,
			transport: null,
		};
	}
	const storagePackage = await createStoragePackage(options.storage);
	const workspaceId =
		options.workspaceId ?? options.workspaceIdForSessionKey?.(TEST_SESSION_KEY);
	const storageOpen = workspaceId
		? await openMiniCutWorkspaceStorage({
				storage: storagePackage.dktStorage,
				workspaceId,
			})
		: null;
	if (storageOpen?.ok === false) {
		throw new Error(
			`MiniCut test workspace storage open failed: ${storageOpen.failureReasonLabel}`,
		);
	}
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
			peer_id: options.peerId ?? "minicut-test-peer",
			storage: storagePackage.crdtStorage,
			profile_id: options.profileId ?? "minicut-crdt-v1",
			profile_version: options.profileVersion ?? 1,
			...(options.transport ? { transport: options.transport } : null),
		}) as MiniCutDktCrdtRuntime,
		storagePackage,
		storageOpen,
		transport: options.transport ?? null,
	};
};

/**
 * Bootstrap the MiniCut DKT model graph for unit tests.
 * No sync_sender, no JSDOM, no transport — pure DKT model layer.
 * Follows Linkcraft's testingInit pattern for proper error handling and flow settling.
 */
export const bootDktModels = async (
	options: BootDktModelsOptions = {},
): Promise<DktTestContext> => {
	const errorsCatcher = catchFlowErrors();
	const { crdtRuntime, storagePackage, storageOpen, transport } =
		await createCrdtRuntimeForTests(options.crdt);
	const runtime = prepareAppRuntime({
		sync_sender: false,
		proxies: false,
		warnUnexpectedAttrs: false,
		unload_models: options.unloadModels === true,
		unloadAllAfterTransaction: options.unloadModels === true,
		diagnostics: {
			suppressUnloadPinningWarning: true,
		},
		graphSemantics: options.graphSemantics,
		aggregateValidation: options.aggregateValidation,
		...(crdtRuntime ? { crdtRuntime } : null),
		...(storagePackage ? { dkt_storage: storagePackage.dktStorage } : null),
		onError: (err: unknown) => {
			errorsCatcher.reject_error_prom(err);
		},
	}) as {
		start(options: {
			App: typeof MiniCutAppRoot;
			interfaces: Record<string, unknown>;
		}): Promise<{ app_model: AnyModel; flow?: AnyModel }>;
		whenAllReady?: (fn: () => void) => void;
		input?: (fn: () => void | Promise<void>) => unknown;
		last_error?: Promise<unknown>;
	};

	const startPromise: Promise<RuntimeStartResult> = options.reinitFromSnapshot
		? (Promise.resolve(
				reinit(
					MiniCutAppRoot,
					runtime,
					options.reinitFromSnapshot,
					options.interfaces ?? {},
					{ reinit_all_attrs: true },
				),
			) as Promise<RuntimeStartResult>)
		: runtime.start({
				App: MiniCutAppRoot,
				interfaces: options.interfaces ?? {},
			});

	const inited = (await raceWithProcessErrors([
		runtime.last_error ?? neverPromise(),
		errorsCatcher.last_error_prom,
		startPromise,
	])) as {
		app_model: AnyModel;
		flow?: AnyModel;
	};

	const appModel = inited.app_model;
	if (crdtRuntime && transport && crdtRuntime.attachTransport) {
		crdtRuntime.attachTransport(transport, { baseModel: appModel });
	}
	const runtimeWithCallsFlow = runtime as RuntimeWithCallsFlow;
	const flow = inited.flow || runtimeWithCallsFlow.calls_flow;

	/**
	 * Wait for the entire DKT flow queue to empty.
	 * Uses flow.whenReady() for proper settle semantics (vs input() which queues after pending steps).
	 * Follows Linkcraft's pattern from dkt/test/waitFlow.js
	 */
	const computed = async (): Promise<void> => {
		const waitForReady = async () => {
			if (runtime.whenAllReady) {
				await new Promise<void>((resolve) =>
					runtime.whenAllReady?.(() => resolve()),
				);
			} else if (flow?.whenReady) {
				await new Promise<void>((resolve) => flow.whenReady?.(() => resolve()));
			}
			if (typeof appModel.input === "function") {
				await new Promise<void>((resolve) => appModel.input?.(() => resolve()));
			}
		};
		await raceWithProcessErrors([
			waitForReady(),
			runtime.last_error ?? neverPromise(),
			errorsCatcher.last_error_prom,
		]);
	};

	// Create session root (needed for SessionRoot-level actions like splitSelectedClip)
	const sessionRoot = (await raceWithProcessErrors([
		runtime.last_error ?? neverPromise(),
		errorsCatcher.last_error_prom,
		new Promise<AnyModel>((resolve, reject) => {
			const doHook = async () => {
				try {
					const sr = await hookSessionRoot(appModel, appModel.start_page, {
						sessionKey: TEST_SESSION_KEY,
						route: null,
						storageOpenStatus:
							storageOpen?.openState.status ??
							WORKSPACE_EMPTY_INITIALIZED_STATE.status,
					});
					resolve(sr as AnyModel);
				} catch (err) {
					reject(err);
				}
			};

			if (typeof appModel.input === "function") {
				appModel.input(doHook);
			} else {
				doHook();
			}
		}),
	])) as AnyModel;

	await computed();
	if (options.reinitFromSnapshot) {
		await crdtRuntime?.restoreFromStorage?.();
		await crdtRuntime?.projectCRDTMeta?.(appModel);
		await computed();
	}

	/**
	 * Run an async function and wait for the DKT graph to settle.
	 * Dispatches inside runtime.input(), then races runtime errors against graph settle.
	 */
	const lockToRead = async (fn: () => void | Promise<void>): Promise<void> => {
		await raceWithProcessErrors([
			runtime.last_error ?? neverPromise(),
			errorsCatcher.last_error_prom,
			new Promise<void>((resolve, reject) => {
				const run = async () => {
					try {
						await fn();
						resolve();
					} catch (error) {
						reject(error);
					}
				};

				if (typeof appModel.input === "function") {
					appModel.input(run);
					return;
				}
				if (runtime.input) {
					runtime.input(run);
					return;
				}
				void run();
			}),
		]);
		await computed();
	};

	return {
		appModel,
		sessionRoot,
		runtime,
		computed,
		lockToRead,
		queryRel,
		queryAttr,
		getAttr,
		findByAttr,
		storagePackage,
		crdtStorageOpen: storageOpen,
		close: async () => {
			await storagePackage?.close?.();
		},
	};
};
