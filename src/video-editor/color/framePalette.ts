import { getContrastRatio, hexToOklch, oklchToHex, parseHexColor, rgbToHex, rgbToOklch, suggestReadableTextColor, type RgbColor } from './oklch'

export interface FramePaletteSuggestion {
	textColor: string
	backgroundColor: string
	accentColor: string
	contrastRatio: number
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const createPaletteFromRgbSamples = (samples: RgbColor[]): FramePaletteSuggestion | null => {
	if (samples.length === 0) {
		return null
	}

	const average = samples.reduce<RgbColor>((sum, color) => ({
		r: sum.r + color.r,
		g: sum.g + color.g,
		b: sum.b + color.b,
	}), { r: 0, g: 0, b: 0 })
	const baseRgb = {
		r: average.r / samples.length,
		g: average.g / samples.length,
		b: average.b / samples.length,
	}
	const baseOklch = rgbToOklch(baseRgb)
	const backgroundColor = oklchToHex({
		...baseOklch,
		l: clamp(baseOklch.l < 0.5 ? baseOklch.l * 0.62 : baseOklch.l * 0.52, 0.04, 0.72),
		c: clamp(baseOklch.c * 0.72, 0, 0.2),
	})
	const accentColor = oklchToHex({
		l: clamp(baseOklch.l < 0.5 ? baseOklch.l + 0.28 : baseOklch.l - 0.18, 0.22, 0.86),
		c: clamp(baseOklch.c * 1.18 + 0.04, 0.02, 0.24),
		h: baseOklch.h,
	})
	const textColor = suggestReadableTextColor(accentColor, backgroundColor)

	return {
		textColor,
		backgroundColor,
		accentColor,
		contrastRatio: Number(getContrastRatio(textColor, backgroundColor).toFixed(2)),
	}
}

export const createPaletteFromHex = (value: string): FramePaletteSuggestion | null => {
	const rgb = parseHexColor(value)
	return rgb ? createPaletteFromRgbSamples([rgb]) : null
}

export const collectCanvasRgbSamples = (imageData: ImageData, stride = 4): RgbColor[] => {
	const samples: RgbColor[] = []
	const step = Math.max(1, stride) * 4
	for (let index = 0; index < imageData.data.length; index += step) {
		const alpha = imageData.data[index + 3]
		if (alpha < 24) {
			continue
		}
		samples.push({
			r: imageData.data[index],
			g: imageData.data[index + 1],
			b: imageData.data[index + 2],
		})
	}
	return samples
}

export const sampleVideoFramePalette = (video: HTMLVideoElement): FramePaletteSuggestion | null => {
	if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
		return null
	}

	const canvas = document.createElement('canvas')
	canvas.width = 32
	canvas.height = Math.max(1, Math.round(32 * (video.videoHeight / video.videoWidth)))
	const context = canvas.getContext('2d', { willReadFrequently: true })
	if (!context) {
		return null
	}

	try {
		context.drawImage(video, 0, 0, canvas.width, canvas.height)
		return createPaletteFromRgbSamples(collectCanvasRgbSamples(context.getImageData(0, 0, canvas.width, canvas.height), 3))
	} catch {
		return null
	}
}

export const normalizePaletteHex = (value: string, fallback: string): string =>
	hexToOklch(value) ? rgbToHex(parseHexColor(value) ?? parseHexColor(fallback) ?? { r: 0, g: 0, b: 0 }) : fallback
