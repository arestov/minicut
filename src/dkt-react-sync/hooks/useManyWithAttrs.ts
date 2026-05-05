import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'
import { getAttrsShape, getRelShape } from '../shape/autoShapes'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from './useScope'
import { useShape } from './useShape'

const EMPTY_ITEMS = Object.freeze([]) as readonly []

const normalizeFields = (fields: readonly string[]) => Array.from(new Set(fields)).sort()

const areItemsEqual = (left: readonly ReactSyncScopeAttrsItem[], right: readonly ReactSyncScopeAttrsItem[], fields: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index]
    const rightItem = right[index]
    if (leftItem.scope._nodeId !== rightItem.scope._nodeId) {
      return false
    }
    for (const field of fields) {
      if (!Object.is(leftItem.attrs[field], rightItem.attrs[field])) {
        return false
      }
    }
  }

  return true
}

export interface ReactSyncScopeAttrsItem {
  scope: ReactSyncScopeHandle
  attrs: Record<string, unknown>
}

export const useManyWithAttrs = (rel: string, fields: readonly string[]): readonly ReactSyncScopeAttrsItem[] => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const normalizedFields = useMemo(() => normalizeFields(fields), fields)
  const snapshotRef = useRef<readonly ReactSyncScopeAttrsItem[]>(EMPTY_ITEMS)

  useShape(getRelShape(rel))
  useShape(getAttrsShape(normalizedFields))

  const subscribe = useCallback((listener: () => void) => {
    if (!scope) {
      return () => {}
    }

    let attrCleanups: Array<() => void> = []
    const cleanupAttrs = () => {
      for (const cleanup of attrCleanups) {
        cleanup()
      }
      attrCleanups = []
    }
    const bindAttrs = () => {
      cleanupAttrs()
      attrCleanups = runtime.readMany(scope, rel).map((itemScope) => runtime.subscribeAttrs(itemScope, normalizedFields, listener))
    }
    const handleListChange = () => {
      bindAttrs()
      listener()
    }

    bindAttrs()
    const cleanupList = runtime.subscribeMany(scope, rel, handleListChange)

    return () => {
      cleanupList()
      cleanupAttrs()
    }
  }, [runtime, scope, rel, normalizedFields])

  const getSnapshot = useCallback(() => {
    if (!scope) {
      snapshotRef.current = EMPTY_ITEMS
      return EMPTY_ITEMS
    }

    const nextSnapshot = runtime.readMany(scope, rel).map((itemScope) => ({
      scope: itemScope,
      attrs: runtime.readAttrs(itemScope, normalizedFields),
    }))
    if (areItemsEqual(snapshotRef.current, nextSnapshot, normalizedFields)) {
      return snapshotRef.current
    }

    snapshotRef.current = nextSnapshot
    return nextSnapshot
  }, [runtime, scope, rel, normalizedFields])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
