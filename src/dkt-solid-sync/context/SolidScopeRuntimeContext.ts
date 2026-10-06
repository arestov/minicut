import { type Accessor, createContext, useContext } from "solid-js";
import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";

export const SolidScopeRuntimeContext = createContext<ReactScopeRuntime>();

/** Reactive accessor of the scope that the surrounding component renders in. */
export type ScopeAccessor = Accessor<ReactSyncScopeHandle | null>;

export const ScopeContext = createContext<ScopeAccessor>(() => null);
export const RootScopeContext = createContext<ScopeAccessor>(() => null);

export const useScopeRuntime = (): ReactScopeRuntime => {
	const runtime = useContext(SolidScopeRuntimeContext);

	if (!runtime) {
		throw new Error("solid sync runtime is required. render inside RootScope");
	}

	return runtime;
};

export const useScope = (): ScopeAccessor => useContext(ScopeContext);

export const useRootScope = (): ScopeAccessor => useContext(RootScopeContext);
