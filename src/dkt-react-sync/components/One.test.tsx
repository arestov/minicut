import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAttrs } from '../hooks/useAttrs'
import { RootScope } from '../scope/RootScope'
import { createTestReactScopeRuntime } from '../test/createTestReactScopeRuntime'
import { One } from './One'

describe('One', () => {
  it('renders a one-rel child with attrs read in the child scope', () => {
    const runtime = createTestReactScopeRuntime({
      attrsByNodeId: {
        project: { title: 'Project A' },
      },
      relsByNodeId: {
        root: { activeProject: 'project' },
      },
    })

    const ProjectTitle = () => {
      const attrs = useAttrs(['title'])
      return <h1>{String(attrs.title)}</h1>
    }

    render(
      <RootScope runtime={runtime}>
        <One rel="activeProject" fallback={<span>No project</span>}>
          <ProjectTitle />
        </One>
      </RootScope>,
    )

    expect(screen.getByRole('heading', { name: 'Project A' })).toBeInTheDocument()
    expect(screen.queryByText('No project')).not.toBeInTheDocument()
  })

  it('updates when the one-rel target changes', () => {
    const runtime = createTestReactScopeRuntime({
      attrsByNodeId: {
        first: { title: 'First' },
        second: { title: 'Second' },
      },
      relsByNodeId: {
        root: { activeProject: 'first' },
      },
    })

    const ProjectTitle = () => {
      const attrs = useAttrs(['title'])
      return <h1>{String(attrs.title)}</h1>
    }

    render(
      <RootScope runtime={runtime}>
        <One rel="activeProject" fallback={<span>No project</span>}>
          <ProjectTitle />
        </One>
      </RootScope>,
    )

    expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument()

    act(() => {
      runtime.updateOne('root', 'activeProject', 'second')
    })

    expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument()
  })
})
