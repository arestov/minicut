import { createContext } from 'react'
import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'

export const ScopeContext = createContext<ReactSyncScopeHandle | null>(null)