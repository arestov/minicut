import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { waitForAttr, waitForMany, waitForOne } from "./scopeWait";

/**
 * Shape the scenario scripts mount to see the nodes they have to address
 * (active project, its tracks and resources). It is demand for the driver
 * only; UI components declare their own shapes.
 */
const driverResourceShape = defineShape({
	attrs: [
		"name",
		"kind",
		"status",
		"localMediaAvailability",
		"originalAccessStatus",
	],
});

const driverShape = defineShape({
	attrs: ["activeProjectId"],
	one: {
		activeProject: defineShape({
			attrs: ["title"],
			many: {
				tracks: defineShape({
					attrs: ["kind", "name"],
					many: {
						clips: defineShape({
							attrs: ["name"],
							one: { resource: driverResourceShape },
						}),
					},
				}),
				resources: driverResourceShape,
			},
		}),
	},
});

const BATCH_CHUNK = 25;

export type ScenarioDriver = {
	/** Resolves when the page sync runtime has a root scope. */
	root(): Promise<ReactSyncScopeHandle>;
	/**
	 * Runs a model action and resolves when the runtime accepted and settled
	 * it. Sync updates reach the page later, so reads must use the `wait*`
	 * helpers below, never a read right after `run`.
	 */
	run(
		actionName: string,
		payload?: unknown,
		scope?: ReactSyncScopeHandle | null,
	): Promise<void>;
	/** Dispatches actions in chunks of 25 and resolves once all are accepted. */
	runBatch(
		actions: ReadonlyArray<{
			actionName: string;
			payload?: unknown;
			scope?: ReactSyncScopeHandle | null;
		}>,
	): Promise<void>;
	/** Resolves when the scope has a one-rel target. */
	waitOne(
		scope: ReactSyncScopeHandle,
		relName: string,
	): Promise<ReactSyncScopeHandle>;
	/** Resolves when a many-rel has at least `minCount` members. */
	waitMany(
		scope: ReactSyncScopeHandle,
		relName: string,
		minCount: number,
	): Promise<readonly ReactSyncScopeHandle[]>;
	/** Resolves with an attr value once it has arrived (not undefined). */
	waitAttr(scope: ReactSyncScopeHandle, attrName: string): Promise<unknown>;
	destroy(): void;
};

/**
 * Drives seed scenarios through the page sync runtime the way a user would:
 * every mutation is a model action addressed to a scope; reads go through the
 * same scope runtime the UI uses. Mutation and read are separate steps.
 */
export const createScenarioDriver = (runtime: PageSyncRuntime): ScenarioDriver => {
	let releaseShape: (() => void) | null = null;

	const rootReady = new Promise<ReactSyncScopeHandle>((resolve) => {
		const check = () => {
			const scope = runtime.getRootScope();
			if (scope) {
				stop();
				resolve(scope);
			}
		};
		const stop = runtime.subscribeRootScope(check);
		check();
	}).then((scope) => {
		releaseShape = runtime.mountShape(scope, driverShape);
		return scope;
	});

	return {
		root: () => rootReady,
		async run(actionName, payload, scope) {
			await rootReady;
			await runtime.dispatchAndWait(actionName, payload, scope ?? null);
		},
		async runBatch(actions) {
			await rootReady;
			// Sequential chunks: each dispatchAndWait has its own timeout, so one
			// huge concurrent batch could trip it once processing is slow.
			for (let index = 0; index < actions.length; index += BATCH_CHUNK) {
				await Promise.all(
					actions
						.slice(index, index + BATCH_CHUNK)
						.map(({ actionName, payload, scope }) =>
							runtime.dispatchAndWait(actionName, payload, scope ?? null),
						),
				);
			}
		},
		waitOne: (scope, relName) =>
			waitForOne(runtime, scope, relName, (target) => target !== null).then(
				(target) => target as ReactSyncScopeHandle,
			),
		waitMany: (scope, relName, minCount) =>
			waitForMany(runtime, scope, relName, (count) => count >= minCount),
		waitAttr: (scope, attrName) =>
			waitForAttr(runtime, scope, attrName, (value) => value !== undefined),
		destroy() {
			releaseShape?.();
			releaseShape = null;
		},
	};
};
