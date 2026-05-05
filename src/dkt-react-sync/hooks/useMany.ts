import { useSyncExternalStore } from 'react'
import { getRelShape } from '../shape/autoShapes'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from './useScope'
import { useShape } from './useShape'

const EMPTY_ITEMS = Object.freeze([]) as readonly []

export const useMany = (rel: string) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const shape = getRelShape(rel)

  useShape(shape)

  return useSyncExternalStore(
    (listener) => (scope ? runtime.subscribeMany(scope, rel, listener) : () => {}),
    () => (scope ? runtime.readMany(scope, rel) : EMPTY_ITEMS),
    () => (scope ? runtime.readMany(scope, rel) : EMPTY_ITEMS),
  )
}
