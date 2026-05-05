import type { EffectAttrs } from '../domain/types'

export type DktEffectActionName = 'setEffectName' | 'setEffectKind' | 'setEffectEnabled' | 'setEffectAmount' | 'setEffectParams' | 'setEffectColor'
export type DktEffectActionPatch = Partial<EffectAttrs>

export const reduceEffectNameAction = (payload: unknown): Pick<EffectAttrs, 'name'> | null => {
	const name = typeof payload === 'string'
		? payload
		: (payload as { name?: unknown } | null)?.name
	return typeof name === 'string' ? { name } : null
}

export const reduceEffectKindAction = (payload: unknown): Pick<EffectAttrs, 'kind'> | null => {
	const kind = (payload as { kind?: unknown } | null)?.kind ?? payload
	return kind === 'blur' || kind === 'sharpen' || kind === 'tint' || kind === 'color-correction' || kind === 'vignette' || kind === 'lut'
		? { kind }
		: null
}

export const reduceEffectEnabledAction = (payload: unknown): Pick<EffectAttrs, 'enabled'> | null => {
	const enabled = typeof payload === 'boolean'
		? payload
		: (payload as { enabled?: unknown } | null)?.enabled
	return typeof enabled === 'boolean' ? { enabled } : null
}

export const reduceEffectAmountAction = (payload: unknown): Pick<EffectAttrs, 'amount'> | null => {
	if (typeof payload === 'number') {
		return { amount: payload }
	}
	if (!payload || typeof payload !== 'object' || !('amount' in payload)) {
		return null
	}
	const amount = (payload as { amount?: unknown }).amount
	return typeof amount === 'number' || amount === undefined ? { amount } : null
}

export const reduceEffectParamsAction = (payload: unknown): Pick<EffectAttrs, 'params'> | null => {
	const params = (payload as { params?: unknown } | null)?.params ?? payload
	return params && typeof params === 'object' ? { params: params as EffectAttrs['params'] } : null
}

export const reduceEffectColorAction = (payload: unknown): Pick<EffectAttrs, 'color'> | null => {
	const color = (payload as { color?: unknown } | null)?.color ?? payload
	return color && typeof color === 'object' ? { color: color as EffectAttrs['color'] } : null
}
