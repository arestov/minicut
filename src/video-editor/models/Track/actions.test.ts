import { describe, expect, it } from 'vitest'
import { normalizeRightSplitClipAttrs, removeClipRef } from './actions'

const modelRef = (_node_id: string) => ({ _node_id })

describe('Track model actions', () => {
	it('removes clip refs by DKT node id', () => {
		expect(removeClipRef([modelRef('clip:left'), modelRef('clip:right')], 'clip:left')).toEqual([modelRef('clip:right')])
		expect(removeClipRef([modelRef('clip:left')], 'clip:missing')).toBeNull()
	})

	it('creates right split clip attrs from source clip bounds', () => {
		expect(normalizeRightSplitClipAttrs({
			sourceClipId: 'clip:right',
			name: 'Right',
			sourceClip: { start: 1, in: 2, duration: 5 },
			splitTime: 3,
		})).toMatchObject({
			sourceClipId: 'clip:right',
			start: 3,
			in: 4,
			duration: 3,
		})
		expect(normalizeRightSplitClipAttrs({
			sourceClipId: 'clip:right',
			sourceClip: { start: 1, in: 2, duration: 5 },
			splitTime: 8,
		})).toBeNull()
	})
})
