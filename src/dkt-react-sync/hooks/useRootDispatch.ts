import { useSyncExternalStore } from "react";
import { useReactScopeRuntime } from "./useReactScopeRuntime";

/**
 * Like useActions, but always dispatches to the root (session) scope regardless
 * of the current ScopeContext. Use inside project-scoped subtrees for session
 * actions (setCursor, zoomTimeline, togglePlayback, etc.).
 */
export const useRootDispatch = () => {
	const runtime = useReactScopeRuntime();
	const rootScope = useSyncExternalStore(
		runtime.subscribeRootScope.bind(runtime),
		runtime.getRootScope.bind(runtime),
		runtime.getRootScope.bind(runtime),
	);
	return runtime.getDispatch(rootScope);
};
