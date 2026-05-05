import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from './useScope'
import { getAttrsShape } from '../shape/autoShapes'
import { useShape } from './useShape'

const normalizeFields = (fields: readonly string[]) => Array.from(new Set(fields)).sort()
const EMPTY_ATTRS = Object.freeze({}) as Record<string, unknown>

export const useAttrs = (fields: readonly string[]) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const normalizedFields = useMemo(() => normalizeFields(fields), fields)
  const shape = getAttrsShape(normalizedFields)
  const resolvedScope = scope ?? runtime.getRootScope()

  useShape(shape)

  const subscribe = useCallback(
    (listener: () => void) => resolvedScope ? runtime.subscribeAttrs(resolvedScope, normalizedFields, listener) : () => {},
    [runtime, resolvedScope, normalizedFields],
  )

  // Keep this hook thin like Weather: React 19 snapshot identity is guaranteed by
  // ReactSyncReceiver/PageSyncRuntime read caches. Do not clone or compare attrs here.
  const getSnapshot = useCallback(
    () => resolvedScope ? runtime.readAttrs(resolvedScope, normalizedFields) : EMPTY_ATTRS,
    [runtime, resolvedScope, normalizedFields],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}