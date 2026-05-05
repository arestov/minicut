import { describe, expect, it } from 'vitest'
import { reduceSessionTickPlaybackAction } from './actions'

describe('SessionRoot actions', () => {
  it('advances cursor for scoped playback ticks only while playing', () => {
    expect(reduceSessionTickPlaybackAction({ deltaSeconds: 0.127 }, { cursor: 1, isPlaying: true })).toEqual({ cursor: 1.13 })
    expect(reduceSessionTickPlaybackAction({ deltaSeconds: 1 }, { cursor: 1, isPlaying: false })).toBeNull()
  })
})
