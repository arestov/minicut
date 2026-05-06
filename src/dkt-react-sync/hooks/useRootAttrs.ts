import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { getAttrsShape } from '../shape/autoShapes'
import { useShape } from './useShape'

const normalizeFields = (fields: readonly string[]) => Array.from(new Set(fields)).sort()
const EMPTY_ATTRS = Object.freeze({}) as Record<string, unknown>

/**
 * Like useAttrs, but always reads from the root (session) scope regardless of
 * the current ScopeContext. Use this inside <One rel="activeProject"> subtrees
 * where the local scope is a project but you still need session-level attrs.
 */
export const useRootAttrs = (fields: readonly string[]): Record<string, unknown> => {
  const runtime = useReactScopeRuntime()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const normalizedFields = useMemo(() => normalizeFields(fields), fields)
  const shape = getAttrsShape(normalizedFields)
  useShape(shape)

  const rootScope = useSyncExternalStore(
    runtime.subscribeRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
  )

  const subscribe = useCallback(
    (listener: () => void) => rootScope ? runtime.subscribeAttrs(rootScope, normalizedFields, listener) : () => {},
    [runtime, rootScope, normalizedFields],
  )

  const getSnapshot = useCallback(
    () => rootScope ? runtime.readAttrs(rootScope, normalizedFields) : EMPTY_ATTRS,
    [runtime, rootScope, normalizedFields],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
