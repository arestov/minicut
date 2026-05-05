import { describe, expect, it } from 'vitest'
import { reduceDktEffectAction } from './effectActions'

describe('DKT effect actions', () => {
	it('returns direct effect attr patches', () => {
		expect(reduceDktEffectAction({ amount: 0.8, enabled: false })).toEqual({
			amount: 0.8,
			enabled: false,
		})
		expect(reduceDktEffectAction(null)).toBeNull()
	})
})
