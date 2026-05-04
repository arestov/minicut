import type { RenderedClip } from '../legend/derivedTimeline'

export interface RgbaSampleFrame {
	width: number
	height: number
	data: ArrayLike<number>
}

export interface ScopeDensityFrame {
	width: number
	height: number
	cells: number[]
}

export interface WaveformScopeData extends ScopeDensityFrame {
	type: 'waveform'
}

export interface RgbParadeScopeData {
	type: 'rgb-parade'
	width: number
	height: number
	red: number[]
	green: number[]
	blue: number[]
}

export interface VectorscopePoint {
	x: number
	y: number
	tint: string
	tintRgb: [number, number, number]
	intensity: number
}

export interface VectorscopeData extends ScopeDensityFrame {
	type: 'vectorscope'
	points: VectorscopePoint[]
}

export interface PreviewScopeData {
	clipCount: number
	sampleCount: number
	source: 'sampled-frame' | 'fallback-color'
	waveform: WaveformScopeData
	rgbParade: RgbParadeScopeData
	vectorscope: VectorscopeData
}

export type ScopeSampleFrames = Record<string, RgbaSampleFrame | undefined>

const waveformWidth = 128
const waveformHeight = 72
const paradeChannelWidth = 56
const paradeHeight = 72
const vectorscopeSize = 72
const maxVectorPoints = 360

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const createCells = (width: number, height: number): number[] => Array.from({ length: width * height }, () => 0)

const addDensity = (cells: number[], width: number, height: number, x: number, y: number, weight: number): void => {
	const scaledX = Math.min(width - 1, Math.max(0, x * (width - 1)))
	const scaledY = Math.min(height - 1, Math.max(0, y * (height - 1)))
	const left = Math.floor(scaledX)
	const top = Math.floor(scaledY)
	const right = Math.min(width - 1, left + 1)
	const bottom = Math.min(height - 1, top + 1)
	const xWeight = scaledX - left
	const yWeight = scaledY - top
	cells[top * width + left] += weight * (1 - xWeight) * (1 - yWeight)
	cells[top * width + right] += weight * xWeight * (1 - yWeight)
	cells[bottom * width + left] += weight * (1 - xWeight) * yWeight
	cells[bottom * width + right] += weight * xWeight * yWeight
}

const normalizeCells = (cells: number[]): number[] => {
	const max = Math.max(0, ...cells)
	return cells.map((value) => max > 0 ? Math.round((value / max) * 1000) / 1000 : 0)
}

const finiteOr = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback

const parseHexColor = (color: string): [number, number, number] => {
	const normalized = color.trim().replace(/^#/, '')
	if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
		return [
			Number.parseInt(normalized.slice(0, 2), 16) / 255,
			Number.parseInt(normalized.slice(2, 4), 16) / 255,
			Number.parseInt(normalized.slice(4, 6), 16) / 255,
		]
	}

	return [0.5, 0.5, 0.5]
}

const toCssRgb = ([red, green, blue]: [number, number, number]): string =>
	`rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`

const parseFilterValue = (filters: string[], name: string, fallback: number): number => {
	const expression = filters.join(' ')
	const match = expression.match(new RegExp(`${name}\\(([-0-9.]+)`))
	return match ? finiteOr(Number(match[1]), fallback) : fallback
}

const rotateHueApprox = ([red, green, blue]: [number, number, number], degrees: number): [number, number, number] => {
	if (!Number.isFinite(degrees) || degrees === 0) {
		return [red, green, blue]
	}

	const radians = (degrees * Math.PI) / 180
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)
	return [
		clamp01(red * (0.213 + cos * 0.787 - sin * 0.213) + green * (0.715 - cos * 0.715 - sin * 0.715) + blue * (0.072 - cos * 0.072 + sin * 0.928)),
		clamp01(red * (0.213 - cos * 0.213 + sin * 0.143) + green * (0.715 + cos * 0.285 + sin * 0.14) + blue * (0.072 - cos * 0.072 - sin * 0.283)),
		clamp01(red * (0.213 - cos * 0.213 - sin * 0.787) + green * (0.715 - cos * 0.715 + sin * 0.715) + blue * (0.072 + cos * 0.928 + sin * 0.072)),
	]
}

const applyFilterApproximation = (
	[baseRed, baseGreen, baseBlue]: [number, number, number],
	filters: string[],
): [number, number, number] => {
	let red = baseRed
	let green = baseGreen
	let blue = baseBlue
	const brightness = parseFilterValue(filters, 'brightness', 1)
	const contrast = parseFilterValue(filters, 'contrast', 1)
	const saturation = parseFilterValue(filters, 'saturate', 1)
	const hue = parseFilterValue(filters, 'hue-rotate', 0)

	red = clamp01((red - 0.5) * contrast + 0.5)
	green = clamp01((green - 0.5) * contrast + 0.5)
	blue = clamp01((blue - 0.5) * contrast + 0.5)

	red = clamp01(red * brightness)
	green = clamp01(green * brightness)
	blue = clamp01(blue * brightness)

	const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
	red = clamp01(luma + (red - luma) * saturation)
	green = clamp01(luma + (green - luma) * saturation)
	blue = clamp01(luma + (blue - luma) * saturation)

	return rotateHueApprox([red, green, blue], hue)
}

const createFallbackFrame = (clip: RenderedClip): RgbaSampleFrame => {
	const width = 24
	const height = 16
	const [baseRed, baseGreen, baseBlue] = parseHexColor(clip.color)
	const data = new Uint8ClampedArray(width * height * 4)
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const gradient = 0.38 + (x / Math.max(1, width - 1)) * 0.44
			const vertical = 0.88 + (y / Math.max(1, height - 1)) * 0.18
			const offset = (y * width + x) * 4
			data[offset] = Math.round(clamp01(baseRed * gradient * vertical) * 255)
			data[offset + 1] = Math.round(clamp01(baseGreen * gradient * vertical) * 255)
			data[offset + 2] = Math.round(clamp01(baseBlue * gradient * vertical) * 255)
			data[offset + 3] = 255
		}
	}
	return { width, height, data }
}

const getClipSampleFrame = (clip: RenderedClip, sampleFrames: ScopeSampleFrames): { frame: RgbaSampleFrame; sampled: boolean } => {
	const sample = sampleFrames[clip.id] ?? (clip.resourceId ? sampleFrames[clip.resourceId] : undefined)
	if (sample && sample.width > 0 && sample.height > 0 && sample.data.length >= sample.width * sample.height * 4) {
		return { frame: sample, sampled: true }
	}

	return { frame: createFallbackFrame(clip), sampled: false }
}

const getPixel = (frame: RgbaSampleFrame, pixelIndex: number): [number, number, number, number] => {
	const offset = pixelIndex * 4
	return [
		finiteOr(frame.data[offset], 0) / 255,
		finiteOr(frame.data[offset + 1], 0) / 255,
		finiteOr(frame.data[offset + 2], 0) / 255,
		finiteOr(frame.data[offset + 3], 255) / 255,
	]
}

const getVectorscopeCoordinates = (red: number, green: number, blue: number): { x: number; y: number; intensity: number } => {
	const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
	const chromaRed = red - luma
	const chromaBlue = blue - luma
	return {
		x: Math.max(-1, Math.min(1, chromaRed * 1.55)),
		y: Math.max(-1, Math.min(1, chromaBlue * 1.55)),
		intensity: Math.max(0.05, Math.min(1, Math.abs(chromaRed) + Math.abs(chromaBlue))),
	}
}


export const createPreviewScopeData = (
	clips: RenderedClip[],
	sampleFrames: ScopeSampleFrames = {},
): PreviewScopeData => {
	const visualClips = clips.filter((clip) => clip.resourceKind !== 'audio' && clip.opacity > 0)
	const waveform = createCells(waveformWidth, waveformHeight)
	const redParade = createCells(paradeChannelWidth, paradeHeight)
	const greenParade = createCells(paradeChannelWidth, paradeHeight)
	const blueParade = createCells(paradeChannelWidth, paradeHeight)
	const vectorscope = createCells(vectorscopeSize, vectorscopeSize)
	const vectorscopePoints: VectorscopePoint[] = []
	let sampleCount = 0
	let sampledClipCount = 0

	for (const clip of visualClips) {
		const { frame, sampled } = getClipSampleFrame(clip, sampleFrames)
		if (sampled) {
			sampledClipCount += 1
		}

		const pixelCount = frame.width * frame.height
		const vectorStep = Math.max(1, Math.floor(pixelCount / maxVectorPoints))
		for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
			const [rawRed, rawGreen, rawBlue, alpha] = getPixel(frame, pixelIndex)
			if (alpha <= 0.01) {
				continue
			}

			const [red, green, blue] = applyFilterApproximation([rawRed, rawGreen, rawBlue], clip.filters)
			const x = (pixelIndex % frame.width) / Math.max(1, frame.width - 1)
			const luma = clamp01(red * 0.2126 + green * 0.7152 + blue * 0.0722)
			const weight = clip.opacity * alpha

			addDensity(waveform, waveformWidth, waveformHeight, x, 1 - luma, weight)
			addDensity(redParade, paradeChannelWidth, paradeHeight, x, 1 - red, weight)
			addDensity(greenParade, paradeChannelWidth, paradeHeight, x, 1 - green, weight)
			addDensity(blueParade, paradeChannelWidth, paradeHeight, x, 1 - blue, weight)

			const vector = getVectorscopeCoordinates(red, green, blue)
			addDensity(vectorscope, vectorscopeSize, vectorscopeSize, (vector.x + 1) / 2, (1 - vector.y) / 2, weight)
			if (pixelIndex % vectorStep === 0 && vectorscopePoints.length < maxVectorPoints * visualClips.length) {
				const tintRgb: [number, number, number] = [red, green, blue]
				vectorscopePoints.push({
					x: Math.round(vector.x * 1000) / 1000,
					y: Math.round(vector.y * 1000) / 1000,
					tint: toCssRgb(tintRgb),
					tintRgb,
					intensity: Math.round(vector.intensity * 1000) / 1000,
				})
			}
			sampleCount += 1
		}
	}

	return {
		clipCount: visualClips.length,
		sampleCount,
		source: sampledClipCount > 0 ? 'sampled-frame' : 'fallback-color',
		waveform: { type: 'waveform', width: waveformWidth, height: waveformHeight, cells: normalizeCells(waveform) },
		rgbParade: {
			type: 'rgb-parade',
			width: paradeChannelWidth,
			height: paradeHeight,
			red: normalizeCells(redParade),
			green: normalizeCells(greenParade),
			blue: normalizeCells(blueParade),
		},
		vectorscope: { type: 'vectorscope', width: vectorscopeSize, height: vectorscopeSize, cells: normalizeCells(vectorscope), points: vectorscopePoints },
	}
}