import { describe, expect, it } from 'vitest'

import { miniActionFlowSnapshot } from './__fixtures__/miniActionFlowSnapshot.js'
import {
  collectActionHighlight,
  serializeActionHighlight,
} from './actionHighlight.js'

describe('action highlight', () => {
  it('highlights models, rel rows, and subflow actions for split flow snapshot', () => {
    const flow = miniActionFlowSnapshot.action_flows.find(
      (item) => item.id === 'clip.splitSelfAt',
    )
    const highlight = serializeActionHighlight(
      collectActionHighlight(miniActionFlowSnapshot, flow),
    )

    expect(highlight.modelNames).toEqual(['clip', 'project', 'resource', 'text', 'track'])
    expect(highlight.nodeIds).toEqual(['model:1', 'model:2', 'model:3', 'model:4', 'model:5'])
    expect(highlight.flowIds).toEqual(['clip.splitSelfAt', 'track.splitClipAt'])
    expect(highlight.subflowIds).toEqual(['track.splitClipAt'])
    expect(highlight.relKeys).toEqual([
      'rel:model:1:activeTrack',
      'rel:model:2:clips',
      'rel:model:3:project',
      'rel:model:3:resource',
      'rel:model:3:text',
      'rel:model:3:track',
    ])
  })
})
