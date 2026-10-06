import { createContext } from "react";
import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";

export const ReactScopeRuntimeContext = createContext<ReactScopeRuntime | null>(
	null,
);
