import type { EffectAttrs } from '../domain/types'

export type DktEffectActionName = 'updateAttrs'
export type DktEffectActionPatch = Partial<EffectAttrs>

export const reduceDktEffectAction = (payload: unknown): DktEffectActionPatch | null => {
	const attrs = payload as Partial<EffectAttrs> | null
	return attrs && typeof attrs === 'object' ? attrs : null
}
