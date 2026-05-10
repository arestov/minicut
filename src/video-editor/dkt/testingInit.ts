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

import { prepare as prepareAppRuntime } from "dkt/runtime/app/prepare.js";
import { _getCurrentRel } from "dkt-all/libs/provoda/_internal/_listRels.js";
import { hookSessionRoot } from "dkt-all/libs/provoda/provoda/BrowseMap.js";
import { MiniCutAppRoot } from "../models/AppRoot";

type AnyModel = {
	_node_id?: string | null;
	model_name?: string | null;
	states?: Record<string, unknown>;
	input?: (callback: () => void | Promise<void>) => unknown;
	queryRel?: (relName: string) => Promise<unknown> | unknown;
	dispatch: (actionName: string, payload?: unknown) => Promise<void> | void;
	start_page?: unknown;
};

type RuntimeWithCallsFlow = {
	calls_flow?: AnyModel;
	whenAllReady?: (fn: () => void) => void;
};

/**
 * Query a rel on a model. Returns [] when rel is empty/null.
 */
export const queryRel = async (
	model: AnyModel,
	relName: string,
): Promise<AnyModel[]> => {
	const result = model.queryRel
		? await model.queryRel(relName)
		: _getCurrentRel(model as Parameters<typeof _getCurrentRel>[0], relName);
	if (Array.isArray(result)) return result.filter(Boolean) as AnyModel[];
	if (result && typeof result === "object" && "_node_id" in result)
		return [result as AnyModel];
	return [];
};

/**
 * Read a reactive attr from a model.
 * Missing attrs are normalized to null to match DKT default-state reads.
 */
export const getAttr = (model: AnyModel, attrName: string): unknown =>
	model.states?.[attrName] ?? null;

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
	computed: () => Promise<void>;
	/**
	 * Run a dispatch inside app_model.input() and wait for settle.
	 * Use this for all dispatches in tests to guarantee ordering.
	 */
	lockToRead: (fn: () => void | Promise<void>) => Promise<void>;
	queryRel: typeof queryRel;
	getAttr: typeof getAttr;
	findByAttr: typeof findByAttr;
};

export type BootDktModelsOptions = {
	interfaces?: Record<string, unknown>;
};

/**
 * Bootstrap the MiniCut DKT model graph for unit tests.
 * No sync_sender, no JSDOM, no transport — pure DKT model layer.
 * Follows Linkcraft's testingInit pattern for proper error handling and flow settling.
 */
export const bootDktModels = async (
	options: BootDktModelsOptions = {},
): Promise<DktTestContext> => {
	const runtime = prepareAppRuntime({
		sync_sender: false,
		proxies: false,
		warnUnexpectedAttrs: false,
	}) as {
		start(options: {
			App: typeof MiniCutAppRoot;
			interfaces: Record<string, unknown>;
		}): Promise<{ app_model: AnyModel; flow?: AnyModel }>;
		last_error?: Promise<unknown>;
		whenAllReady?: (fn: () => void) => void;
		input?: (fn: () => void | Promise<void>) => unknown;
	};

	const inited = await runtime.start({
		App: MiniCutAppRoot,
		interfaces: options.interfaces ?? {},
	});

	const appModel = inited.app_model;
	const runtimeWithCallsFlow = runtime as RuntimeWithCallsFlow;
	const flow = inited.flow || runtimeWithCallsFlow.calls_flow;

	/**
	 * Wait for the entire DKT flow queue to empty.
	 * Uses flow.whenReady() for proper settle semantics (vs input() which queues after pending steps).
	 * Follows Linkcraft's pattern from dkt/test/waitFlow.js
	 */
	const computed = async (): Promise<void> => {
		if (runtime.whenAllReady) {
			return new Promise<void>((resolve) =>
				runtime.whenAllReady(() => resolve()),
			);
		}
		if (flow?.whenReady) {
			return new Promise<void>((resolve) => flow.whenReady(() => resolve()));
		}
		// Fallback if neither available
		await new Promise<void>((resolve) => {
			if (typeof appModel.input === "function") {
				appModel.input?.(() => resolve());
			} else {
				resolve();
			}
		});
	};

	// Create session root (needed for SessionRoot-level actions like splitSelectedClip)
	const sessionRoot = await new Promise<AnyModel>((resolve, reject) => {
		const doHook = async () => {
			try {
				const sr = await hookSessionRoot(appModel, appModel.start_page, {
					sessionKey: "test-session",
					route: null,
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
	});

	await computed();

	/**
	 * Run an async function and wait for the DKT graph to settle.
	 * Dispatches directly, then waits for the shared DKT flow queue to become idle.
	 * This keeps action tests deterministic without wrapping every dispatch in app_model.input().
	 */
	const lockToRead = async (fn: () => void | Promise<void>): Promise<void> => {
		await fn();
		await computed();
	};

	return {
		appModel,
		sessionRoot,
		computed,
		lockToRead,
		queryRel,
		getAttr,
		findByAttr,
	};
};
