import { useSyncExternalStore } from 'react'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'

/**
 * Reads a one-rel from the root (session) scope. Use inside project-scoped
 * subtrees to access session-level rels like selectedClip, selectedText, etc.
 */
export const useRootOne = (relName: string): ReactSyncScopeHandle | null => {
  const runtime = useReactScopeRuntime()
  const rootScope = useSyncExternalStore(
    runtime.subscribeRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
  )
  return useSyncExternalStore(
    (listener) => rootScope ? runtime.subscribeOne(rootScope, relName, listener) : () => {},
    () => rootScope ? runtime.readOne(rootScope, relName) : null,
    () => rootScope ? runtime.readOne(rootScope, relName) : null,
  )
}
