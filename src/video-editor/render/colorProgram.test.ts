import { colorProgramToCssFilter, compileEffectColorProgram } from './colorProgram'

describe('color program', () => {
	it('compiles color correction into typed operations before CSS output', () => {
		const program = compileEffectColorProgram({
			name: 'Primary',
			kind: 'color-correction',
			enabled: true,
			params: {
				exposure: { value: 0.25 },
				contrast: { value: 1.2 },
				saturation: { value: 1.5 },
				temperature: { value: 0.4 },
				hue: { value: 12 },
				gamma: { value: 1 },
			},
		})

		expect(program).toEqual({
			effectKind: 'color-correction',
			enabled: true,
			operations: [
				{ type: 'brightness', value: 1.25 },
				{ type: 'contrast', value: 1.2 },
				{ type: 'saturate', value: 1.532 },
				{ type: 'sepia', value: 0.1 },
				{ type: 'hue-rotate', value: 12 },
			],
		})
		expect(colorProgramToCssFilter(program)).toBe('brightness(1.25) contrast(1.2) saturate(1.532) sepia(0.1) hue-rotate(12deg)')
	})

	it('uses negative temperature as a cool hue shift in the CSS fallback', () => {
		const program = compileEffectColorProgram({
			name: 'Cool',
			kind: 'color-correction',
			enabled: true,
			params: { temperature: { value: -0.5 } },
		})

		expect(program.operations).toContainEqual({ type: 'hue-rotate', value: -9 })
		expect(colorProgramToCssFilter(program)).toBe('brightness(1) contrast(1) saturate(1) hue-rotate(-9deg)')
	})
})
