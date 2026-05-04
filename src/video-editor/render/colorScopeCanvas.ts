import type { ScopeDensityFrame, VectorscopePoint } from './colorScopes'

export interface ScopeRgbColor {
	red: number
	green: number
	blue: number
}

export interface ScopeBitmapOptions {
	alphaFloor?: number
	alphaScale?: number
}

export const parseScopeColor = (color: string): ScopeRgbColor => {
	const normalized = color.trim()
	const hex = normalized.replace(/^#/, '')
	if (/^[0-9a-fA-F]{6}$/.test(hex)) {
		return {
			red: Number.parseInt(hex.slice(0, 2), 16),
			green: Number.parseInt(hex.slice(2, 4), 16),
			blue: Number.parseInt(hex.slice(4, 6), 16),
		}
	}

	const rgbMatch = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
	if (rgbMatch) {
		return {
			red: Math.min(255, Math.max(0, Number(rgbMatch[1]))),
			green: Math.min(255, Math.max(0, Number(rgbMatch[2]))),
			blue: Math.min(255, Math.max(0, Number(rgbMatch[3]))),
		}
	}

	return { red: 244, green: 244, blue: 245 }
}

export const createScopeDensityBitmap = (
	frame: ScopeDensityFrame,
	tint: ScopeRgbColor,
	options: ScopeBitmapOptions = {},
): ImageData => {
	const alphaFloor = options.alphaFloor ?? 0.08
	const alphaScale = options.alphaScale ?? 0.92
	const pixels = new Uint8ClampedArray(frame.width * frame.height * 4)

	for (let index = 0; index < frame.cells.length; index += 1) {
		const value = frame.cells[index]
		if (value <= 0) {
			continue
		}

		const offset = index * 4
		pixels[offset] = tint.red
		pixels[offset + 1] = tint.green
		pixels[offset + 2] = tint.blue
		pixels[offset + 3] = Math.round(Math.min(1, alphaFloor + value * alphaScale) * 255)
	}

	return new ImageData(pixels, frame.width, frame.height)
}

export const drawScopeDensityCanvas = (
	context: CanvasRenderingContext2D,
	frame: ScopeDensityFrame,
	tint: string,
	options: ScopeBitmapOptions = {},
): void => {
	context.clearRect(0, 0, frame.width, frame.height)
	context.putImageData(createScopeDensityBitmap(frame, parseScopeColor(tint), options), 0, 0)
}

export const drawVectorscopePoints = (
	context: CanvasRenderingContext2D,
	points: VectorscopePoint[],
	width: number,
	height: number,
): void => {
	context.save()
	context.globalCompositeOperation = 'screen'
	for (const point of points) {
		const x = Math.min(width - 1, Math.max(0, ((point.x + 1) / 2) * width))
		const y = Math.min(height - 1, Math.max(0, ((1 - point.y) / 2) * height))
		context.globalAlpha = Math.min(0.72, Math.max(0.18, point.intensity * 0.72))
		context.fillStyle = point.tint
		context.beginPath()
		context.arc(x, y, 1.35, 0, Math.PI * 2)
		context.fill()
	}
	context.restore()
}