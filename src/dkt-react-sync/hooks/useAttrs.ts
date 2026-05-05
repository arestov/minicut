import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from './useScope'
import { getAttrsShape } from '../shape/autoShapes'
import { useShape } from './useShape'

const normalizeFields = (fields: readonly string[]) => Array.from(new Set(fields)).sort()

export const useAttrs = (fields: readonly string[]) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const normalizedFields = useMemo(() => normalizeFields(fields), fields)
  const shape = getAttrsShape(normalizedFields)
  const resolvedScope = scope ?? runtime.getRootScope()

  if (!resolvedScope) {
    throw new Error('react sync scope is required. render inside RootScope')
  }

  useShape(shape)

  const subscribe = useCallback(
    (listener: () => void) => runtime.subscribeAttrs(resolvedScope, normalizedFields, listener),
    [runtime, resolvedScope, normalizedFields],
  )

  const getSnapshot = useCallback(
    () => runtime.readAttrs(resolvedScope, normalizedFields),
    [runtime, resolvedScope, normalizedFields],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}