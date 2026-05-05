import type { AnimatedScalar, ColorCorrectionAttrs, TextAttrs } from './types'

const scalar = (value: number): AnimatedScalar => ({ value })

export const createDefaultColorCorrectionAttrs = (): ColorCorrectionAttrs => ({
	exposure: scalar(0),
	contrast: scalar(1),
	highlights: scalar(0),
	shadows: scalar(0),
	saturation: scalar(1),
	vibrance: scalar(0),
	temperature: scalar(0),
	tint: scalar(0),
	hue: scalar(0),
	gamma: scalar(1),
})

export const createDefaultTextAttrs = (content = 'Text'): TextAttrs => ({
	content,
	style: {
		fontFamily: 'Inter, Segoe UI, sans-serif',
		fontSize: 64,
		fontWeight: 700,
		lineHeight: 1.1,
		letterSpacing: 0,
		color: '#ffffff',
		backgroundColor: 'rgba(0, 0, 0, 0)',
		align: 'center',
	},
	box: {
		width: 760,
		height: 220,
	},
})
