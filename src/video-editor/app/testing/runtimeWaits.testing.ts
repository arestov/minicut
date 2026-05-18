import type { ReactSyncScopeHandle } from "../../../dkt-react-sync/scope/ScopeHandle";
import type { EditorActionEnvironment } from "../editorActionEnvironment";

// TEST-ONLY helpers: keep polling waits out of shared production adapters.
export const sleepTesting = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export const waitForRuntimeReadyOrThrowTesting = async (
	runtime: {
		getSnapshot: () => {
			ready: boolean;
			booted?: unknown;
			rootNodeId?: unknown;
		};
	},
	options?: {
		timeoutMs?: number;
		pollMs?: number;
		role?: string | null;
	},
): Promise<void> => {
	const timeoutMs = options?.timeoutMs ?? 15_000;
	const pollMs = options?.pollMs ?? 50;
	const role = options?.role ?? null;
	const deadline = Date.now() + timeoutMs;

	while (!runtime.getSnapshot().ready) {
		if (Date.now() >= deadline) {
			const snapshot = runtime.getSnapshot();
			throw new Error(
				`Runtime not ready after ${timeoutMs}ms (role=${role} booted=${String(snapshot.booted)} rootNodeId=${String(snapshot.rootNodeId)})`,
			);
		}
		await sleepTesting(pollMs);
	}
};

// TEST-ONLY: polling for active project scope (phase 4 cleanup)
// In production code, activeProject should be available through event-driven initialization.
// This helper is for test scenarios where timing is uncertain.
export const waitForActiveProjectScopeTesting = async (
	env: EditorActionEnvironment,
	maxAttempts = 50,
	delayMs = 100,
): Promise<ReactSyncScopeHandle | null> => {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const projectScope = getActiveProjectScopeTesting(env);
		if (projectScope) {
			return projectScope;
		}
		if (env.lifecycle.isDestroyed()) {
			return null;
		}
		await new Promise<void>((resolve) => {
			env.lifecycle.setTimeout(resolve, delayMs);
		});
	}

	return getActiveProjectScopeTesting(env);
};

// Internal helper for test waits
const getActiveProjectScopeTesting = (
	env: EditorActionEnvironment,
): ReactSyncScopeHandle | null => {
	const pageRuntime = env.pageRuntime;
	if (!pageRuntime) {
		return null;
	}

	const rootScope = pageRuntime.getRootScope();
	if (!rootScope) {
		return null;
	}

	const activeProject = pageRuntime.readOne(rootScope, "activeProject");
	if (activeProject) {
		return activeProject;
	}

	const pioneerScope = pageRuntime.readOne(rootScope, "pioneer");
	if (!pioneerScope) {
		return null;
	}

	const projects = pageRuntime.readMany(pioneerScope, "project");
	return projects[0] ?? null;
};
