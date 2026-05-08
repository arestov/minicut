import { useSyncExternalStore } from 'react'
import { ScopeContext } from '../context/ScopeContext'
import { useReactScopeRuntime } from '../hooks/useReactScopeRuntime'
import { useScope } from '../hooks/useScope'
import { useShape } from '../hooks/useShape'
import { getRelShape } from '../shape/autoShapes'
import { useAttrs } from '../hooks/useAttrs'

const EMPTY_ITEMS = Object.freeze([]) as readonly []

/**
 * Gates rendering of a single item until a specific attr is non-null.
 * Mounted inside each item's ScopeContext so useAttrs reads the right scope.
 */
const ReadyGate = ({
  attrName,
  children,
}: {
  attrName: string
  children: React.ReactNode
}) => {
  const attrs = useAttrs([attrName])
  return attrs[attrName] != null ? <>{children}</> : null
}

export const Many = ({
  rel,
  item: Item,
  empty = null,
  limit,
  readyAttr,
}: {
  rel: string
  item: React.ComponentType
  empty?: React.ReactNode
  limit?: number
  /**
   * When provided, each item is withheld from rendering until this attr
   * arrives from the worker (i.e. is non-null). Prevents skeleton clips
   * with default-zero positions from briefly appearing in the timeline.
   */
  readyAttr?: string
}) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const shape = getRelShape(rel)

  useShape(shape)

  const items = useSyncExternalStore(
    (listener) => (scope ? runtime.subscribeMany(scope, rel, listener) : () => {}),
    () => (scope ? runtime.readMany(scope, rel) : EMPTY_ITEMS),
    () => (scope ? runtime.readMany(scope, rel) : EMPTY_ITEMS),
  )

  const visibleItems = typeof limit === 'number' ? items.slice(0, Math.max(0, limit)) : items

  if (!scope || !visibleItems.length) {
    return <>{empty}</>
  }

  return (
    <>
      {visibleItems.map((itemScope) => (
        <ScopeContext.Provider key={itemScope._nodeId} value={itemScope}>
          {readyAttr
            ? <ReadyGate attrName={readyAttr}><Item /></ReadyGate>
            : <Item />
          }
        </ScopeContext.Provider>
      ))}
    </>
  )
}