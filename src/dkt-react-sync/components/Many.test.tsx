import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAttrs } from '../hooks/useAttrs'
import { RootScope } from '../scope/RootScope'
import { createTestReactScopeRuntime } from '../test/createTestReactScopeRuntime'
import { Many } from './Many'

describe('Many', () => {
  it('iterates rel scopes while children read attrs in their own scope', () => {
    const runtime = createTestReactScopeRuntime({
      attrsByNodeId: {
        first: { name: 'First' },
        second: { name: 'Second' },
      },
      relsByNodeId: {
        root: { items: ['first', 'second'] },
      },
    })

    const Item = () => {
      const attrs = useAttrs(['name'])
      return <li>{String(attrs.name)}</li>
    }

    render(
      <RootScope runtime={runtime}>
        <ul>
          <Many rel="items" item={Item} />
        </ul>
      </RootScope>,
    )

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('updates only from rel subscription without combining child attrs in the parent', () => {
    const runtime = createTestReactScopeRuntime({
      attrsByNodeId: {
        first: { name: 'First' },
        second: { name: 'Second' },
      },
      relsByNodeId: {
        root: { items: ['first'] },
      },
    })

    const Item = () => {
      const attrs = useAttrs(['name'])
      return <li>{String(attrs.name)}</li>
    }

    render(
      <RootScope runtime={runtime}>
        <ul>
          <Many rel="items" item={Item} />
        </ul>
      </RootScope>,
    )

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.queryByText('Second')).not.toBeInTheDocument()

    act(() => {
      runtime.updateMany('root', 'items', ['first', 'second'])
    })

    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})