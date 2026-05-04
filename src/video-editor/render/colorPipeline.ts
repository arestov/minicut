import type { EffectAttrs } from '../domain/types'
import { colorProgramToCssFilter, compileEffectColorProgram, mergeColorProgramCssFilters } from './colorProgram'

export interface EffectRenderInstruction {
	kind: EffectAttrs['kind']
	name: string
	enabled: boolean
	amount?: number
	params?: Record<string, unknown>
}

export const toEffectRenderInstruction = (attrs: EffectAttrs): EffectRenderInstruction => ({
	kind: attrs.kind,
	name: attrs.name,
	enabled: attrs.enabled !== false,
	...(attrs.amount !== undefined ? { amount: attrs.amount } : {}),
	...(attrs.params ? { params: attrs.params as Record<string, unknown> } : {}),
})

export const getEffectInstructionFilter = (effect: EffectRenderInstruction): string => {
	return colorProgramToCssFilter(compileEffectColorProgram(effect))
}

export const mergeEffectFilters = (effects: EffectRenderInstruction[]): string =>
	mergeColorProgramCssFilters(effects.map(compileEffectColorProgram))
