import { describe, expect, it } from 'vitest'
import { reduceDktSessionAction } from './sessionActions'

const sessionState = {
	isPlaying: true,
	timelineZoom: 16,
}

describe('DKT session actions', () => {
	it('normalizes entity selection as a direct DKT attr patch', () => {
		expect(reduceDktSessionAction('selectEntity', 'clip:1', sessionState)).toEqual({
			selectedEntityId: 'clip:1',
		})
		expect(reduceDktSessionAction('selectEntity', null, sessionState)).toEqual({
			selectedEntityId: null,
		})
	})

	it('clamps cursor values and ignores non-finite payloads', () => {
		expect(reduceDktSessionAction('setCursor', -4.129, sessionState)).toEqual({ cursor: 0 })
		expect(reduceDktSessionAction('setCursor', 4.129, sessionState)).toEqual({ cursor: 4.13 })
		expect(reduceDktSessionAction('setCursor', Number.NaN, sessionState)).toBeNull()
	})

	it('uses declared deps for playback and zoom actions', () => {
		expect(reduceDktSessionAction('togglePlayback', undefined, sessionState)).toEqual({
			isPlaying: false,
		})
		expect(reduceDktSessionAction('zoomTimeline', 90, sessionState)).toEqual({
			timelineZoom: 96,
		})
		expect(reduceDktSessionAction('zoomTimeline', -20, sessionState)).toEqual({
			timelineZoom: 8,
		})
	})
})
