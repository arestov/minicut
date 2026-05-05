import { model } from 'dkt/model.js'
import { clipUpdateOpacityAction } from '../clipActions'

const getOpacityPercent = (payload: unknown): number | null => {
	if (typeof payload === 'number') {
		return payload
	}

	const value = (payload as { opacityPercent?: unknown } | null)?.opacityPercent
	return typeof value === 'number' ? value : null
}

export const Clip = model({
	model_name: 'minicut_clip',
	attrs: {
		name: ['input', 'Clip'],
		color: ['input', '#2563eb'],
		opacity: ['input', { value: 1 }],
	},
	actions: {
		updateOpacity: {
			to: {
				opacity: ['opacity'],
			},
			fn: (payload: unknown) => {
				const opacityPercent = getOpacityPercent(payload)
				const nextOpacity = opacityPercent === null ? null : clipUpdateOpacityAction.fn(opacityPercent)
				return nextOpacity ? { opacity: nextOpacity } : '$noop'
			},
		},
	},
})
