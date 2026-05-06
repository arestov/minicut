import { getEffectInstructionFilter, mergeEffectFilters, toEffectRenderInstruction } from './colorPipeline'
import type { EffectAttrs } from '../models/Effect/types'

describe('color pipeline', () => {
	it('normalizes effect attrs into render instructions', () => {
		const attrs: EffectAttrs = { name: 'Primary', kind: 'color-correction', enabled: true, params: { exposure: { value: 0.25 }, saturation: { value: 1.4 } } }
		const instruction = toEffectRenderInstruction(attrs)

		expect(instruction).toMatchObject({ name: 'Primary', kind: 'color-correction', enabled: true })
		expect(instruction.params).toMatchObject({ exposure: { value: 0.25 }, saturation: { value: 1.4 } })
	})

	it('compiles deterministic css filters for color correction params', () => {
		const filter = getEffectInstructionFilter({
			name: 'Primary',
			kind: 'color-correction',
			enabled: true,
			params: {
				exposure: { value: 0.25 },
				contrast: { value: 1.2 },
				saturation: { value: 1.5 },
				hue: { value: 12 },
				gamma: { value: 1 },
			},
		})

		expect(filter).toBe('brightness(1.25) contrast(1.2) saturate(1.5) hue-rotate(12deg)')
	})

	it('drops disabled effects from merged filters', () => {
		expect(mergeEffectFilters([
			{ name: 'Disabled blur', kind: 'blur', enabled: false, amount: 1 },
			{ name: 'Tint', kind: 'tint', enabled: true, amount: 0.5 },
		])).toBe('sepia(0.5) saturate(1.5)')
	})
})
