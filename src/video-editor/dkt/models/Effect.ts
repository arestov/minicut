import { model } from 'dkt/model.js'
import { reduceDktEffectAction } from '../effectActions'

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
		updateAttrs: {
			to: {
				name: ['name'],
				kind: ['kind'],
				enabled: ['enabled'],
				amount: ['amount'],
				params: ['params'],
				color: ['color'],
			},
			fn: (payload: unknown) => reduceDktEffectAction(payload) ?? '$noop',
		},
	},
})

export const EFFECT_PROXY_CREATION_SHAPE = {
	attrs: ['sourceEffectId', 'name', 'kind', 'enabled', 'amount', 'params', 'color'],
} as const
