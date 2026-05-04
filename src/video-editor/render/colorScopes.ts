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

export interface PreviewScopeBuildOptions {
	includeWaveform?: boolean
	includeRgbParade?: boolean
	includeVectorscope?: boolean
	includeVectorscopePoints?: boolean
}

export type ScopeSampleFrames = Record<string, RgbaSampleFrame | undefined>

const waveformWidth = 128
const waveformHeight = 72
const paradeChannelWidth = 56
const paradeHeight = 72
const vectorscopeSize = 72
const maxVectorPoints = 360

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

interface CompiledFilterAdjustments {
	brightness: number
	contrast: number
	saturation: number
	hue: {
		enabled: boolean
		m00: number
		m01: number
		m02: number
		m10: number
		m11: number
		m12: number
		m20: number
		m21: number
		m22: number
	}
}

interface ClipScopeSource {
	clip: RenderedClip
	frame: RgbaSampleFrame
	sampled: boolean
	filterAdjustments: CompiledFilterAdjustments
	vectorStep: number
}

const createCells = (width: number, height: number): Float32Array => new Float32Array(width * height)
const createZeroCells = (width: number, height: number): number[] => new Array<number>(width * height).fill(0)

const addDensity = (cells: Float32Array, width: number, height: number, x: number, y: number, weight: number): void => {
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

const normalizeCells = (cells: ArrayLike<number>): number[] => {
	let max = 0
	for (let index = 0; index < cells.length; index += 1) {
		const value = cells[index]
		if (value > max) {
			max = value
		}
	}

	const normalized = new Array<number>(cells.length)
	if (max <= 0) {
		normalized.fill(0)
		return normalized
	}

	for (let index = 0; index < cells.length; index += 1) {
		normalized[index] = Math.round((cells[index] / max) * 1000) / 1000
	}
	return normalized
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

const parseFilterToken = (filter: string): { name: string; value: number } | null => {
	const match = filter.match(/^\s*([a-z-]+)\(([-0-9.]+)/i)
	if (!match) {
		return null
	}

	const name = String(match[1]).toLowerCase()
	const value = finiteOr(Number(match[2]), Number.NaN)
	if (!Number.isFinite(value)) {
		return null
	}

	return { name, value }
}

const compileFilterAdjustments = (filters: string[]): CompiledFilterAdjustments => {
	let brightness = 1
	let contrast = 1
	let saturation = 1
	let hueDegrees = 0

	for (const filter of filters) {
		const token = parseFilterToken(filter)
		if (!token) {
			continue
		}

		switch (token.name) {
			case 'brightness':
				brightness = token.value
				break
			case 'contrast':
				contrast = token.value
				break
			case 'saturate':
				saturation = token.value
				break
			case 'hue-rotate':
				hueDegrees = token.value
				break
			default:
				break
		}
	}

	if (!Number.isFinite(hueDegrees) || hueDegrees === 0) {
		return {
			brightness,
			contrast,
			saturation,
			hue: {
				enabled: false,
				m00: 1,
				m01: 0,
				m02: 0,
				m10: 0,
				m11: 1,
				m12: 0,
				m20: 0,
				m21: 0,
				m22: 1,
			},
		}
	}

	const radians = (hueDegrees * Math.PI) / 180
	const cos = Math.cos(radians)
	const sin = Math.sin(radians)
	return {
		brightness,
		contrast,
		saturation,
		hue: {
			enabled: true,
			m00: 0.213 + cos * 0.787 - sin * 0.213,
			m01: 0.715 - cos * 0.715 - sin * 0.715,
			m02: 0.072 - cos * 0.072 + sin * 0.928,
			m10: 0.213 - cos * 0.213 + sin * 0.143,
			m11: 0.715 + cos * 0.285 + sin * 0.14,
			m12: 0.072 - cos * 0.072 - sin * 0.283,
			m20: 0.213 - cos * 0.213 - sin * 0.787,
			m21: 0.715 - cos * 0.715 + sin * 0.715,
			m22: 0.072 + cos * 0.928 + sin * 0.072,
		},
	}
}

const applyFilterApproximation = (
	rawRed: number,
	rawGreen: number,
	rawBlue: number,
	filterAdjustments: CompiledFilterAdjustments,
): [number, number, number] => {
 	let red = rawRed
	let green = rawGreen
	let blue = rawBlue

	if (filterAdjustments.contrast !== 1) {
		red = clamp01((red - 0.5) * filterAdjustments.contrast + 0.5)
		green = clamp01((green - 0.5) * filterAdjustments.contrast + 0.5)
		blue = clamp01((blue - 0.5) * filterAdjustments.contrast + 0.5)
	}

	if (filterAdjustments.brightness !== 1) {
		red = clamp01(red * filterAdjustments.brightness)
		green = clamp01(green * filterAdjustments.brightness)
		blue = clamp01(blue * filterAdjustments.brightness)
	}

	const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
	if (filterAdjustments.saturation !== 1) {
		red = clamp01(luma + (red - luma) * filterAdjustments.saturation)
		green = clamp01(luma + (green - luma) * filterAdjustments.saturation)
		blue = clamp01(luma + (blue - luma) * filterAdjustments.saturation)
	}

	if (!filterAdjustments.hue.enabled) {
		return [red, green, blue]
	}

	const hue = filterAdjustments.hue
	return [
		clamp01(red * hue.m00 + green * hue.m01 + blue * hue.m02),
		clamp01(red * hue.m10 + green * hue.m11 + blue * hue.m12),
		clamp01(red * hue.m20 + green * hue.m21 + blue * hue.m22),
	]
}

const buildClipScopeSources = (clips: RenderedClip[], sampleFrames: ScopeSampleFrames): ClipScopeSource[] => {
	const sources: ClipScopeSource[] = []
	for (const clip of clips) {
		if (clip.resourceKind === 'audio' || clip.opacity <= 0) {
			continue
		}

		const { frame, sampled } = getClipSampleFrame(clip, sampleFrames)
		const pixelCount = frame.width * frame.height
		sources.push({
			clip,
			frame,
			sampled,
			filterAdjustments: compileFilterAdjustments(clip.filters),
			vectorStep: Math.max(1, Math.floor(pixelCount / maxVectorPoints)),
		})
	}

	return sources
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
	options: PreviewScopeBuildOptions = {},
): PreviewScopeData => {
	const includeWaveform = options.includeWaveform ?? true
	const includeRgbParade = options.includeRgbParade ?? true
	const includeVectorscope = options.includeVectorscope ?? true
	const includeVectorscopePoints = options.includeVectorscopePoints ?? includeVectorscope
	const clipScopeSources = buildClipScopeSources(clips, sampleFrames)
	const visualClips = clipScopeSources.map((source) => source.clip)
	const waveform = includeWaveform ? createCells(waveformWidth, waveformHeight) : null
	const redParade = includeRgbParade ? createCells(paradeChannelWidth, paradeHeight) : null
	const greenParade = includeRgbParade ? createCells(paradeChannelWidth, paradeHeight) : null
	const blueParade = includeRgbParade ? createCells(paradeChannelWidth, paradeHeight) : null
	const vectorscope = includeVectorscope ? createCells(vectorscopeSize, vectorscopeSize) : null
	const vectorscopePoints: VectorscopePoint[] = []
	let sampleCount = 0
	let sampledClipCount = 0

	for (const source of clipScopeSources) {
		const { clip, frame, sampled, filterAdjustments, vectorStep } = source
		if (sampled) {
			sampledClipCount += 1
		}

		const width = frame.width
		const height = frame.height
		const data = frame.data
		const xScale = width > 1 ? 1 / (width - 1) : 0
		const pointLimit = includeVectorscope && includeVectorscopePoints ? maxVectorPoints * visualClips.length : 0

		let pixelIndex = 0
		for (let y = 0; y < height; y += 1) {
			for (let xIndex = 0; xIndex < width; xIndex += 1, pixelIndex += 1) {
				const offset = pixelIndex * 4
				const alpha = finiteOr(data[offset + 3], 255) / 255
				if (alpha <= 0.01) {
					continue
				}

				const rawRed = finiteOr(data[offset], 0) / 255
				const rawGreen = finiteOr(data[offset + 1], 0) / 255
				const rawBlue = finiteOr(data[offset + 2], 0) / 255
				const [red, green, blue] = applyFilterApproximation(rawRed, rawGreen, rawBlue, filterAdjustments)
				const x = xIndex * xScale
				const weight = clip.opacity * alpha

				if (includeWaveform && waveform) {
					const luma = clamp01(red * 0.2126 + green * 0.7152 + blue * 0.0722)
					addDensity(waveform, waveformWidth, waveformHeight, x, 1 - luma, weight)
				}

				if (includeRgbParade && redParade && greenParade && blueParade) {
					addDensity(redParade, paradeChannelWidth, paradeHeight, x, 1 - red, weight)
					addDensity(greenParade, paradeChannelWidth, paradeHeight, x, 1 - green, weight)
					addDensity(blueParade, paradeChannelWidth, paradeHeight, x, 1 - blue, weight)
				}

				if (includeVectorscope && vectorscope) {
					const vector = getVectorscopeCoordinates(red, green, blue)
					addDensity(vectorscope, vectorscopeSize, vectorscopeSize, (vector.x + 1) / 2, (1 - vector.y) / 2, weight)
					if (pixelIndex % vectorStep === 0 && vectorscopePoints.length < pointLimit) {
						const tintRgb: [number, number, number] = [red, green, blue]
						vectorscopePoints.push({
							x: Math.round(vector.x * 1000) / 1000,
							y: Math.round(vector.y * 1000) / 1000,
							tintRgb,
							intensity: Math.round(vector.intensity * 1000) / 1000,
						})
					}
				}
				sampleCount += 1
			}
		}
	}

	return {
		clipCount: visualClips.length,
		sampleCount,
		source: sampledClipCount > 0 ? 'sampled-frame' : 'fallback-color',
		waveform: {
			type: 'waveform',
			width: waveformWidth,
			height: waveformHeight,
			cells: waveform ? normalizeCells(waveform) : createZeroCells(waveformWidth, waveformHeight),
		},
		rgbParade: {
			type: 'rgb-parade',
			width: paradeChannelWidth,
			height: paradeHeight,
			red: redParade ? normalizeCells(redParade) : createZeroCells(paradeChannelWidth, paradeHeight),
			green: greenParade ? normalizeCells(greenParade) : createZeroCells(paradeChannelWidth, paradeHeight),
			blue: blueParade ? normalizeCells(blueParade) : createZeroCells(paradeChannelWidth, paradeHeight),
		},
		vectorscope: {
			type: 'vectorscope',
			width: vectorscopeSize,
			height: vectorscopeSize,
			cells: vectorscope ? normalizeCells(vectorscope) : createZeroCells(vectorscopeSize, vectorscopeSize),
			points: vectorscopePoints,
		},
	}
}