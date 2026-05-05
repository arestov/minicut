import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from './useScope'
import { getAttrsShape } from '../shape/autoShapes'
import { useShape } from './useShape'

const normalizeFields = (fields: readonly string[]) => Array.from(new Set(fields)).sort()
const EMPTY_ATTRS = Object.freeze({}) as Record<string, unknown>

const areAttrsEqual = (left: Record<string, unknown>, right: Record<string, unknown>, fields: readonly string[]): boolean => {
  for (const field of fields) {
    if (!Object.is(left[field], right[field])) {
      return false
    }
  }

  return true
}

export const useAttrs = (fields: readonly string[]) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const normalizedFields = useMemo(() => normalizeFields(fields), fields)
  const shape = getAttrsShape(normalizedFields)
  const resolvedScope = scope ?? runtime.getRootScope()
  const snapshotRef = useRef<Record<string, unknown>>(EMPTY_ATTRS)

  useShape(shape)

  const subscribe = useCallback(
    (listener: () => void) => resolvedScope ? runtime.subscribeAttrs(resolvedScope, normalizedFields, listener) : () => {},
    [runtime, resolvedScope, normalizedFields],
  )

  const getSnapshot = useCallback(
    () => {
      if (!resolvedScope) {
        snapshotRef.current = EMPTY_ATTRS
        return EMPTY_ATTRS
      }

      const nextSnapshot = runtime.readAttrs(resolvedScope, normalizedFields)
      if (areAttrsEqual(snapshotRef.current, nextSnapshot, normalizedFields)) {
        return snapshotRef.current
      }

      snapshotRef.current = nextSnapshot
      return nextSnapshot
    },
    [runtime, resolvedScope, normalizedFields],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}