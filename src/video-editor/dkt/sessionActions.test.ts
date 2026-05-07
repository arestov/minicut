import { describe, expect, it } from 'vitest'
import {
	reduceSessionSelectEntityAction,
	reduceSessionSetCursorAction,
	reduceSessionTogglePlaybackAction,
	reduceSessionZoomTimelineAction,
} from './sessionActions'

const sessionState = {
	isPlaying: true,
	timelineZoom: 16,
}

describe('DKT session actions', () => {
	it('normalizes entity selection as a direct DKT attr patch', () => {
		expect(reduceSessionSelectEntityAction('clip:1')).toEqual({
			selectedEntityId: 'clip:1',
		})
		expect(reduceSessionSelectEntityAction(null)).toEqual({
			selectedEntityId: null,
		})
	})

	it('clamps cursor values and ignores non-finite payloads', () => {
		expect(reduceSessionSetCursorAction(-4.129)).toEqual({ cursor: 0 })
		expect(reduceSessionSetCursorAction(4.129)).toEqual({ cursor: 4.13 })
		expect(reduceSessionSetCursorAction(Number.NaN)).toBeNull()
	})

	it('uses declared deps for playback and zoom actions', () => {
		expect(reduceSessionTogglePlaybackAction(sessionState)).toEqual({
			isPlaying: false,
		})
		expect(reduceSessionZoomTimelineAction(90, sessionState)).toEqual({
			timelineZoom: 96,
		})
		expect(reduceSessionZoomTimelineAction(-20, sessionState)).toEqual({
			timelineZoom: 8,
		})
	})
})
