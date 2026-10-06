import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";
import {
	type ScopeAccessor,
	useRootScope,
	useScope,
	useScopeRuntime,
} from "../context/SolidScopeRuntimeContext";

export type ScopeDispatch = (
	actionName: string,
	payload?: unknown,
	meta?: unknown,
) => void;

/**
 * A dispatch function that resolves the scope at call time, so one stable
 * function follows the scope accessor (event handlers never see a stale scope).
 */
export const createDispatchFor = (
	runtime: ReactScopeRuntime,
	scope: ScopeAccessor,
): ScopeDispatch => {
	return (actionName, payload, meta) =>
		runtime.getDispatch(scope())(actionName, payload, meta);
};

/** Dispatches actions to the scope the component renders in. */
export const useActions = (): ScopeDispatch =>
	createDispatchFor(useScopeRuntime(), useScope());

/**
 * Like useActions, but always dispatches to the root (session) scope
 * regardless of the surrounding scope.
 */
export const useRootDispatch = (): ScopeDispatch =>
	createDispatchFor(useScopeRuntime(), useRootScope());
