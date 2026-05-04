import { describe, expect, it } from 'vitest'
import {
	fitOklchToSrgb,
	getContrastRatio,
	hexToOklch,
	isOklchInSrgbGamut,
	oklchToHex,
	suggestReadableTextColor,
} from './oklch'

describe('OKLCH color helpers', () => {
	it('round-trips common sRGB hex colors through OKLCH', () => {
		for (const hex of ['#2563eb', '#f8fafc', '#0f172a', '#dc2626']) {
			const oklch = hexToOklch(hex)
			expect(oklch).not.toBeNull()
			expect(oklchToHex(oklch as NonNullable<typeof oklch>)).toBe(hex)
		}
	})

	it('fits out-of-gamut chroma while preserving lightness and hue', () => {
		const color = { l: 0.7, c: 0.6, h: 145 }
		const fitted = fitOklchToSrgb(color)

		expect(isOklchInSrgbGamut(fitted)).toBe(true)
		expect(fitted.l).toBeCloseTo(0.7, 3)
		expect(fitted.h).toBeCloseTo(145, 2)
		expect(fitted.c).toBeLessThan(color.c)
	})

	it('suggests a readable text color for low contrast pairs', () => {
		const improved = suggestReadableTextColor('#475569', '#334155')

		expect(getContrastRatio(improved, '#334155')).toBeGreaterThanOrEqual(4.5)
	})
})
