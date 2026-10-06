import { useEffect, useSyncExternalStore } from "react";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import { getRelShape } from "../../dkt-ui-sync/shape/autoShapes";
import { useReactScopeRuntime } from "./useReactScopeRuntime";

/**
 * Reads a one-rel from the root (session) scope. Use inside project-scoped
 * subtrees to access session-level rels like selectedClip, selectedText, etc.
 */
export const useRootOne = (relName: string): ReactSyncScopeHandle | null => {
	const runtime = useReactScopeRuntime();
	const shape = getRelShape(relName);
	const rootScope = useSyncExternalStore(
		runtime.subscribeRootScope.bind(runtime),
		runtime.getRootScope.bind(runtime),
		runtime.getRootScope.bind(runtime),
	);
	useEffect(() => {
		if (!rootScope) {
			return;
		}
		return runtime.mountShape(rootScope, shape);
	}, [runtime, rootScope, shape]);
	return useSyncExternalStore(
		(listener) =>
			rootScope ? runtime.subscribeOne(rootScope, relName, listener) : () => {},
		() => (rootScope ? runtime.readOne(rootScope, relName) : null),
		() => (rootScope ? runtime.readOne(rootScope, relName) : null),
	);
};
