import { describe, expect, it } from 'vitest'
import { reduceDktTimelineClipAction } from './timelineActions'

const attrs = {
	start: 1,
	in: 1,
	duration: 4,
}

describe('DKT timeline clip actions', () => {
	it('moves clips without allowing negative starts', () => {
		expect(reduceDktTimelineClipAction('moveBy', { delta: 2.25 }, attrs)).toEqual({ start: 3.3 })
		expect(reduceDktTimelineClipAction('moveBy', { delta: -4 }, attrs)).toEqual({ start: 0 })
	})

	it('resizes and trims with the current command-layer bounds', () => {
		expect(reduceDktTimelineClipAction('resize', { edge: 'end', delta: -10 }, attrs)).toEqual({ duration: 0.5 })
		expect(reduceDktTimelineClipAction('trim', { edge: 'start', delta: 0.75 }, attrs)).toEqual({
			start: 1.8,
			in: 1.8,
			duration: 3.2,
		})
	})

	it('plans split by shrinking the left clip only when split is inside bounds', () => {
		expect(reduceDktTimelineClipAction('splitAt', { time: 2.25 }, attrs)).toEqual({ duration: 1.3 })
		expect(reduceDktTimelineClipAction('splitAt', { time: 5 }, attrs)).toBeNull()
	})
})
