import { createContext } from "react";
import type { ReactScopeRuntime } from "../runtime/ReactScopeRuntime";

export const ReactScopeRuntimeContext = createContext<ReactScopeRuntime | null>(
	null,
);
