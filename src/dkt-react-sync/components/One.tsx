import { useSyncExternalStore } from 'react'
import { ScopeContext } from '../context/ScopeContext'
import { useReactScopeRuntime } from '../hooks/useReactScopeRuntime'
import { useScope } from '../hooks/useScope'
import { useShape } from '../hooks/useShape'
import { getRelShape } from '../shape/autoShapes'

export const One = ({
  rel,
  children,
  fallback = null,
}: {
  rel: string
  children: React.ReactNode
  fallback?: React.ReactNode
}) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const shape = getRelShape(rel)

  useShape(shape)

  const childScope = useSyncExternalStore(
    (listener) => (scope ? runtime.subscribeOne(scope, rel, listener) : () => {}),
    () => (scope ? runtime.readOne(scope, rel) : null),
    () => (scope ? runtime.readOne(scope, rel) : null),
  )

  if (!scope || !childScope) {
    return <>{fallback}</>
  }

  return <ScopeContext.Provider value={childScope}>{children}</ScopeContext.Provider>
}