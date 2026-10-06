import { createContext } from "react";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";

export const ScopeContext = createContext<ReactSyncScopeHandle | null>(null);
