import { describe, expect, it, vi } from 'vitest'
import { ShapeRegistry } from './ShapeRegistry'
import { defineShape } from './defineShape'
import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'

const createScope = (nodeId: string): ReactSyncScopeHandle => ({ kind: 'scope', _nodeId: nodeId })

describe('ShapeRegistry', () => {
  it('publishes fresh graph entries once and reference-counts required shapes per node', () => {
    const registry = new ShapeRegistry()
    const rootScope = createScope('root')
    const childScope = createScope('child')
    const oneListeners = new Set<() => void>()
    const publishShapeGraph = vi.fn()
    const requireNodeShapes = vi.fn()

    const runtime = {
      publishShapeGraph,
      requireNodeShapes,
      readOne: vi.fn(() => childScope),
      subscribeOne: vi.fn((_scope: ReactSyncScopeHandle, _relName: string, listener: () => void) => {
        oneListeners.add(listener)
        return () => oneListeners.delete(listener)
      }),
      readMany: vi.fn(() => []),
      subscribeMany: vi.fn(() => () => {}),
    }

    const childShape = defineShape({ attrs: ['name'] })
    const rootShape = defineShape({ attrs: ['title'], one: { details: childShape } })

    const stopA = registry.mount(runtime, rootScope, rootShape)
    const stopB = registry.mount(runtime, rootScope, rootShape)

    expect(publishShapeGraph).toHaveBeenCalledTimes(1)
    expect(requireNodeShapes.mock.calls).toEqual([
      ['root', [rootShape.id]],
      ['child', [childShape.id]],
    ])

    stopA()
    expect(requireNodeShapes.mock.calls).toEqual([
      ['root', [rootShape.id]],
      ['child', [childShape.id]],
    ])

    stopB()
    expect(requireNodeShapes.mock.calls).toEqual([
      ['root', [rootShape.id]],
      ['child', [childShape.id]],
      ['child', []],
      ['root', []],
    ])
  })
})