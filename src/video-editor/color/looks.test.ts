import { describe, expect, it } from 'vitest'
import { buildLookColorCorrectionParams } from './looks'

describe('look presets', () => {
	it('blends look params from neutral by intensity', () => {
		expect(buildLookColorCorrectionParams('cinema', 0)).toMatchObject({
			lookId: 'cinema',
			lookIntensity: 0,
			exposure: 0,
			contrast: 1,
			saturation: 1,
			temperature: 0,
			hue: 0,
			gamma: 1,
		})

		const half = buildLookColorCorrectionParams('cinema', 0.5)
		expect(half.exposure).toBeCloseTo(-0.02, 6)
		expect(half.contrast).toBeCloseTo(1.09, 6)
		expect(half.saturation).toBeCloseTo(0.97, 6)
		expect(half.temperature).toBe(0)
		expect(half.hue).toBeCloseTo(-2, 6)

		const full = buildLookColorCorrectionParams('cinema', 1)
		expect(full).toMatchObject({ lookId: 'cinema', lookIntensity: 1 })
		expect(full.contrast).toBeCloseTo(1.18, 6)
	})

	it('falls back to the clean look for unknown ids and clamps intensity', () => {
		expect(buildLookColorCorrectionParams('missing', 2)).toMatchObject({
			lookId: 'clean',
			lookIntensity: 1,
			contrast: 1,
			saturation: 1,
		})
	})

	it('sets temperature for every look so stale grade params do not leak between presets', () => {
		expect(buildLookColorCorrectionParams('golden', 0.5).temperature).toBeCloseTo(0.175, 6)
		expect(buildLookColorCorrectionParams('cool', 0.5).temperature).toBeCloseTo(-0.2, 6)
		expect(buildLookColorCorrectionParams('cinema', 1).temperature).toBe(0)
	})
})
