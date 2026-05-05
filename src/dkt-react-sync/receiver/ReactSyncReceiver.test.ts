import { describe, expect, it, vi } from 'vitest'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { ReactSyncReceiver } from './ReactSyncReceiver'

describe('ReactSyncReceiver', () => {
  it('reads attrs and rel scopes from DKT sync chunks with stable cached snapshots', () => {
    const receiver = new ReactSyncReceiver(null)
    const onRoot = vi.fn()
    const onAttrs = vi.fn()
    const onTracks = vi.fn()

    receiver.subscribeRoot(onRoot)
    receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, 'name', 'tracks'])
    receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
      node_id: 'project-1',
      data: [null, null, null],
    })

    receiver.subscribeNodeAttrs('project-1', ['name'], onAttrs)
    receiver.subscribeNodeList('project-1', 'tracks', onTracks)

    receiver.handleSync(SYNCR_TYPES.UPDATE, [
      0,
      'project-1',
      2,
      1,
      'Project 1',
      1,
      'project-1',
      2,
      ['track-1', 'track-2'],
    ])

    expect(onRoot).toHaveBeenCalledTimes(1)
    expect(onAttrs).toHaveBeenCalledTimes(1)
    expect(onTracks).toHaveBeenCalledTimes(1)
    expect(receiver.getRootScope()?._nodeId).toBe('project-1')

    const attrs1 = receiver.readRootAttrs(['name'])
    const attrs2 = receiver.readRootAttrs(['name'])
    expect(attrs1).toBe(attrs2)
    expect(attrs1.name).toBe('Project 1')

    const scopes1 = receiver.readManyScopes(receiver.getRootScope()!, 'tracks')
    const scopes2 = receiver.readManyScopes(receiver.getRootScope()!, 'tracks')
    expect(scopes1).toBe(scopes2)
    expect(scopes1.map((scope) => scope._nodeId)).toEqual(['track-1', 'track-2'])
  })

  it('does not notify rel listeners when a rel payload is structurally unchanged', () => {
    const receiver = new ReactSyncReceiver(null)
    const onTracks = vi.fn()

    receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, 'tracks'])
    receiver.handleSync(SYNCR_TYPES.TREE_ROOT, {
      node_id: 'project-1',
      data: [null, null, null],
    })

    receiver.subscribeNodeList('project-1', 'tracks', onTracks)
    receiver.handleSync(SYNCR_TYPES.UPDATE, [1, 'project-1', 1, ['track-1']])
    receiver.handleSync(SYNCR_TYPES.UPDATE, [1, 'project-1', 1, ['track-1']])

    expect(onTracks).toHaveBeenCalledTimes(1)
  })
})