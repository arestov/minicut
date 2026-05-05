import { model } from 'dkt/model.js'
import {
	reduceEffectAmountAction,
	reduceEffectColorAction,
	reduceEffectEnabledAction,
	reduceEffectKindAction,
	reduceEffectNameAction,
	reduceEffectParamsAction,
} from '../dkt/effectActions'

export const Effect = model({
	model_name: 'minicut_effect',
	attrs: {
		sourceEffectId: ['input', null],
		name: ['input', 'Effect'],
		kind: ['input', 'blur'],
		enabled: ['input', true],
		amount: ['input', null],
		params: ['input', null],
		color: ['input', null],
	},
	actions: {
		setEffectName: {
			to: {
				name: ['name'],
			},
			fn: (payload: unknown) => reduceEffectNameAction(payload) ?? '$noop',
		},
		setEffectKind: {
			to: {
				kind: ['kind'],
			},
			fn: (payload: unknown) => reduceEffectKindAction(payload) ?? '$noop',
		},
		setEffectEnabled: {
			to: {
				enabled: ['enabled'],
			},
			fn: (payload: unknown) => reduceEffectEnabledAction(payload) ?? '$noop',
		},
		setEffectAmount: {
			to: {
				amount: ['amount'],
			},
			fn: (payload: unknown) => reduceEffectAmountAction(payload) ?? '$noop',
		},
		setEffectParams: {
			to: {
				params: ['params'],
			},
			fn: (payload: unknown) => reduceEffectParamsAction(payload) ?? '$noop',
		},
		setEffectColor: {
			to: {
				color: ['color'],
			},
			fn: (payload: unknown) => reduceEffectColorAction(payload) ?? '$noop',
		},
	},
})

export const EFFECT_PROXY_CREATION_SHAPE = {
	attrs: ['sourceEffectId', 'name', 'kind', 'enabled', 'amount', 'params', 'color'],
} as const
