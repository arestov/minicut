import { performance } from 'node:perf_hooks'
import type { RenderedClip } from '../src/video-editor/legend/derivedTimeline'
import { createScopeDensityBitmap } from '../src/video-editor/render/colorScopeCanvas'
import { createPreviewScopeData, type PreviewScopeData, type RgbaSampleFrame } from '../src/video-editor/render/colorScopes'

if (typeof globalThis.ImageData === 'undefined') {
	class BenchImageData {
		readonly data: Uint8ClampedArray
		readonly width: number
		readonly height: number

		constructor(data: Uint8ClampedArray, width: number, height: number) {
			this.data = data
			this.width = width
			this.height = height
		}
	}

	globalThis.ImageData = BenchImageData as typeof ImageData
}

const frameWidth = 192
const frameHeight = 108
const playTickCount = 12
const measuredRounds = 3
const warmupRounds = 1

const createClip = (index: number): RenderedClip => ({
	id: `clip:${index}`,
	resourceId: `resource:${index}`,
	name: `Bench clip ${index}`,
	color: ['#2563eb', '#16a34a', '#dc2626'][index % 3],
	resourceName: `bench-${index}.webm`,
	resourceKind: 'video',
	resourceUrl: `blob:bench-${index}`,
	mime: 'video/webm',
	inPoint: 0,
	start: index * 0.12,
	opacity: 1 - index * 0.12,
	transform: { x: 0, y: 0, scale: 1, rotation: 0 },
	audio: { gain: 1, pan: 0 },
	filters: [
		`brightness(${1 + index * 0.08})`,
		`contrast(${1 + index * 0.04})`,
		`saturate(${1.15 + index * 0.1})`,
		`hue-rotate(${index * 8}deg)`,
	],
	text: null,
})

const createSampleFrame = (seed: number): RgbaSampleFrame => {
	const data = new Uint8ClampedArray(frameWidth * frameHeight * 4)
	for (let y = 0; y < frameHeight; y += 1) {
		for (let x = 0; x < frameWidth; x += 1) {
			const offset = (y * frameWidth + x) * 4
			const horizontal = x / Math.max(1, frameWidth - 1)
			const vertical = y / Math.max(1, frameHeight - 1)
			const wave = (Math.sin((x + seed * 17) * 0.09) + Math.cos((y + seed * 11) * 0.13) + 2) / 4
			data[offset] = Math.round((horizontal * 0.65 + wave * 0.35) * 255)
			data[offset + 1] = Math.round((vertical * 0.45 + (1 - horizontal) * 0.25 + wave * 0.3) * 255)
			data[offset + 2] = Math.round(((1 - vertical) * 0.4 + horizontal * 0.25 + (1 - wave) * 0.35) * 255)
			data[offset + 3] = 255
		}
	}
	return { width: frameWidth, height: frameHeight, data }
}

const clips = [createClip(0), createClip(1), createClip(2)]
const sampleFrameSets = Array.from({ length: playTickCount }, (_, tick) => Object.fromEntries(
	clips.map((clip, index) => [clip.id, createSampleFrame(tick + index * 19)]),
))

const computePlayTickScopes = (): PreviewScopeData[] => {
	const scopes: PreviewScopeData[] = []
	for (let tick = 0; tick < playTickCount; tick += 1) {
		scopes.push(createPreviewScopeData(clips, sampleFrameSets[tick]))
	}
	return scopes
}

const prepareWaveformBitmaps = (scopes: PreviewScopeData[]): void => {
	for (const scope of scopes) {
		createScopeDensityBitmap(scope.waveform, { red: 244, green: 244, blue: 245 })
	}
}

const prepareRgbParadeBitmaps = (scopes: PreviewScopeData[]): void => {
	for (const scope of scopes) {
		createScopeDensityBitmap({ width: scope.rgbParade.width, height: scope.rgbParade.height, cells: scope.rgbParade.red }, { red: 239, green: 68, blue: 68 })
		createScopeDensityBitmap({ width: scope.rgbParade.width, height: scope.rgbParade.height, cells: scope.rgbParade.green }, { red: 34, green: 197, blue: 94 })
		createScopeDensityBitmap({ width: scope.rgbParade.width, height: scope.rgbParade.height, cells: scope.rgbParade.blue }, { red: 59, green: 130, blue: 246 })
	}
}

const percentile = (values: number[], fraction: number): number => {
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))]
}

const measure = (name: string, run: () => void): void => {
	for (let round = 0; round < warmupRounds; round += 1) {
		run()
	}

	const durations: number[] = []
	for (let round = 0; round < measuredRounds; round += 1) {
		const startedAt = performance.now()
		run()
		durations.push(performance.now() - startedAt)
	}

	const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length
	const median = percentile(durations, 0.5)
	const p90 = percentile(durations, 0.9)
	console.log(`${name}: mean=${mean.toFixed(2)}ms median=${median.toFixed(2)}ms p90=${p90.toFixed(2)}ms perTick=${(mean / playTickCount).toFixed(3)}ms`)
}

const precomputedScopes = computePlayTickScopes()

console.log(`Color scope preview-play benchmark: ${playTickCount} ticks, ${clips.length} clips, ${frameWidth}x${frameHeight} RGBA samples per clip`)
measure('compute density JSON', () => {
	computePlayTickScopes()
})
measure('compute + waveform canvas bitmap', () => {
	prepareWaveformBitmaps(computePlayTickScopes())
})
measure('compute + RGB parade canvas bitmaps', () => {
	prepareRgbParadeBitmaps(computePlayTickScopes())
})
measure('structuredClone computed scope JSON', () => {
	structuredClone(precomputedScopes)
})