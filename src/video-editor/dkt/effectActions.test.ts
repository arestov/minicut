import { describe, expect, it } from 'vitest'
import { reduceEffectAmountAction, reduceEffectEnabledAction } from './effectActions'

describe('DKT effect actions', () => {
	it('reduces concrete effect attrs', () => {
		expect(reduceEffectAmountAction({ amount: 0.8 })).toEqual({ amount: 0.8 })
		expect(reduceEffectEnabledAction({ enabled: false })).toEqual({ enabled: false })
		expect(reduceEffectAmountAction(null)).toBeNull()
	})
})
