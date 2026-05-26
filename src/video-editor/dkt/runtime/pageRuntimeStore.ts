import type { PageRootSnapshot } from "../../../dkt-react-sync/runtime/PageSyncRuntime";

export const createEmptyPageRuntimeSnapshot = (): PageRootSnapshot => ({
	booted: false,
	ready: false,
	version: 0,
	rootNodeId: null,
	sessionId: null,
	sessionKey: null,
	workspaceOpenState: null,
	runtimeError: null,
});

export const createPageRuntimeSnapshotWithVersion = (
	current: PageRootSnapshot,
	patch: Partial<PageRootSnapshot>,
): PageRootSnapshot => ({
	...current,
	...patch,
	version: current.version + 1,
});

export const shouldResetPageRuntimeForBootstrap = (
	current: PageRootSnapshot,
	options?: {
		sessionId?: string | null;
		sessionKey?: string | null;
		route?: unknown;
	},
) => {
	if (!current.booted) {
		return false;
	}

	if (options?.sessionKey && options.sessionKey !== current.sessionKey) {
		return true;
	}

	if (options?.sessionId && options.sessionId !== current.sessionId) {
		return true;
	}

	return false;
};
