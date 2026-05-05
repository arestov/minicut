import { describe, expect, it } from 'vitest'
import { defaultTextBox, defaultTextStyle, reduceDktTextAction } from './textActions'

describe('DKT text actions', () => {
	it('merges partial text style and box attrs', () => {
		expect(reduceDktTextAction({
			content: 'After',
			style: { color: '#111827' },
			box: { width: 640 },
		}, { style: defaultTextStyle, box: defaultTextBox })).toEqual({
			content: 'After',
			style: { ...defaultTextStyle, color: '#111827' },
			box: { ...defaultTextBox, width: 640 },
		})
	})
})
