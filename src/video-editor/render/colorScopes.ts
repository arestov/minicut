import type { RenderedClip } from '../legend/derivedTimeline'

export interface WaveformScopeData {
	type: 'waveform'
	buckets: number[]
}

export interface RgbParadeScopeData {
	type: 'rgb-parade'
	red: number[]
	green: number[]
	blue: number[]
}

export interface VectorscopePoint {
	x: number
	y: number
	tint: string
}

export interface VectorscopeData {
	type: 'vectorscope'
	points: VectorscopePoint[]
}

export interface PreviewScopeData {
	clipCount: number
	waveform: WaveformScopeData
	rgbParade: RgbParadeScopeData
	vectorscope: VectorscopeData
}

const bucketCount = 12

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const createBuckets = (): number[] => Array.from({ length: bucketCount }, () => 0)

const getBucketIndex = (value: number): number => Math.min(bucketCount - 1, Math.floor(clamp01(value) * bucketCount))

const normalizeBuckets = (buckets: number[], total: number): number[] =>
	buckets.map((value) => total > 0 ? Math.round((value / total) * 1000) / 1000 : 0)

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

const parseFilterValue = (filters: string[], name: string, fallback: number): number => {
	const expression = filters.join(' ')
	const match = expression.match(new RegExp(`${name}\\(([-0-9.]+)`))
	return match ? Number(match[1]) : fallback
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

const applyFilterApproximation = (clip: RenderedClip): [number, number, number] => {
	let [red, green, blue] = parseHexColor(clip.color)
	const brightness = parseFilterValue(clip.filters, 'brightness', 1)
	const contrast = parseFilterValue(clip.filters, 'contrast', 1)
	const saturation = parseFilterValue(clip.filters, 'saturate', 1)
	const hue = parseFilterValue(clip.filters, 'hue-rotate', 0)

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

export const createPreviewScopeData = (clips: RenderedClip[]): PreviewScopeData => {
	const visualClips = clips.filter((clip) => clip.resourceKind !== 'audio' && clip.opacity > 0)
	const waveform = createBuckets()
	const red = createBuckets()
	const green = createBuckets()
	const blue = createBuckets()
	const vectorscopePoints: VectorscopePoint[] = []

	for (const clip of visualClips) {
		const [r, g, b] = applyFilterApproximation(clip)
		const luma = clamp01(r * 0.2126 + g * 0.7152 + b * 0.0722)
		waveform[getBucketIndex(luma)] += clip.opacity
		red[getBucketIndex(r)] += clip.opacity
		green[getBucketIndex(g)] += clip.opacity
		blue[getBucketIndex(b)] += clip.opacity
		vectorscopePoints.push({
			x: Math.round((r - luma) * 1000) / 1000,
			y: Math.round((b - luma) * 1000) / 1000,
			tint: clip.color,
		})
	}

	return {
		clipCount: visualClips.length,
		waveform: { type: 'waveform', buckets: normalizeBuckets(waveform, visualClips.length) },
		rgbParade: {
			type: 'rgb-parade',
			red: normalizeBuckets(red, visualClips.length),
			green: normalizeBuckets(green, visualClips.length),
			blue: normalizeBuckets(blue, visualClips.length),
		},
		vectorscope: { type: 'vectorscope', points: vectorscopePoints },
	}
}