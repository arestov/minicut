import { describe, expect, it } from 'vitest'
import type { RenderedClip } from '../legend/derivedTimeline'
import { createPreviewScopeData, type RgbaSampleFrame, type ScopeDensityFrame } from './colorScopes'

const createClip = (overrides: Partial<RenderedClip> = {}): RenderedClip => ({
	id: 'clip:1',
	resourceId: 'resource:1',
	name: 'Clip',
	color: '#2563eb',
	resourceName: 'clip.webm',
	resourceKind: 'video',
	resourceUrl: 'blob:clip',
	mime: 'video/webm',
	inPoint: 0,
	start: 0,
	opacity: 1,
	transform: { x: 0, y: 0, scale: 1, rotation: 0 },
	audio: { gain: 1, pan: 0 },
	filters: [],
	text: null,
	...overrides,
})

const createFrame = (
	width: number,
	height: number,
	getPixel: (x: number, y: number) => [number, number, number, number?],
): RgbaSampleFrame => {
	const data = new Uint8ClampedArray(width * height * 4)
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const [red, green, blue, alpha = 255] = getPixel(x, y)
			const offset = (y * width + x) * 4
			data[offset] = red
			data[offset + 1] = green
			data[offset + 2] = blue
			data[offset + 3] = alpha
		}
	}
	return { width, height, data }
}

const countNonZero = (values: number[]): number => values.filter((value) => value > 0).length

const dominantRowsByColumn = (frame: ScopeDensityFrame): number[] => {
	const rows: number[] = []
	for (let x = 0; x < frame.width; x += 1) {
		let bestRow = -1
		let bestValue = 0
		for (let y = 0; y < frame.height; y += 1) {
			const value = frame.cells[y * frame.width + x]
			if (value > bestValue) {
				bestValue = value
				bestRow = y
			}
		}
		rows.push(bestRow)
	}
	return rows
}

describe('color scopes', () => {
	it('returns empty density scopes without visual clips', () => {
		const scopes = createPreviewScopeData([])

		expect(scopes.clipCount).toBe(0)
		expect(scopes.sampleCount).toBe(0)
		expect(scopes.waveform).toMatchObject({ type: 'waveform', width: 128, height: 72 })
		expect(scopes.waveform.cells.every((value) => value === 0)).toBe(true)
		expect(scopes.rgbParade.red.every((value) => value === 0)).toBe(true)
		expect(scopes.vectorscope.points).toEqual([])
	})

	it('ignores audio clips when building visual scopes', () => {
		const scopes = createPreviewScopeData([createClip({ resourceKind: 'audio' })])

		expect(scopes.clipCount).toBe(0)
		expect(scopes.vectorscope.points).toEqual([])
	})

	it('builds a diagonal waveform and neutral vectorscope from a grayscale ramp', () => {
		const clip = createClip({ color: '#808080' })
		const ramp = createFrame(128, 8, (x) => {
			const level = Math.round((x / 127) * 255)
			return [level, level, level]
		})

		const scopes = createPreviewScopeData([clip], { [clip.id]: ramp })
		const dominantRows = dominantRowsByColumn(scopes.waveform)

		expect(scopes.source).toBe('sampled-frame')
		expect(scopes.sampleCount).toBe(1024)
		expect(countNonZero(scopes.waveform.cells)).toBeGreaterThan(100)
		expect(dominantRows[0]).toBeGreaterThan(52)
		expect(dominantRows[127]).toBeLessThan(19)
		expect(scopes.vectorscope.points.length).toBeGreaterThan(100)
		expect(scopes.vectorscope.points.every((point) => Math.abs(point.x) < 0.02 && Math.abs(point.y) < 0.02)).toBe(true)
	})

	it('separates RGB parade density for color-bar style samples', () => {
		const clip = createClip({ color: '#ffffff' })
		const bars: Array<[number, number, number]> = [
			[255, 255, 255],
			[255, 255, 0],
			[0, 255, 255],
			[0, 255, 0],
			[255, 0, 255],
			[255, 0, 0],
			[0, 0, 255],
			[0, 0, 0],
		]
		const colorBars = createFrame(64, 16, (x) => bars[Math.min(bars.length - 1, Math.floor((x / 64) * bars.length))])

		const scopes = createPreviewScopeData([clip], { [clip.id]: colorBars })
		const redNonZero = countNonZero(scopes.rgbParade.red)
		const greenNonZero = countNonZero(scopes.rgbParade.green)
		const blueNonZero = countNonZero(scopes.rgbParade.blue)
		const vectorQuadrants = new Set(scopes.vectorscope.points.map((point) => `${Math.sign(point.x)},${Math.sign(point.y)}`))

		expect(scopes.rgbParade).toMatchObject({ type: 'rgb-parade', width: 56, height: 72 })
		expect(redNonZero).toBeGreaterThan(40)
		expect(greenNonZero).toBeGreaterThan(40)
		expect(blueNonZero).toBeGreaterThan(40)
		expect(vectorQuadrants.size).toBeGreaterThanOrEqual(4)
		expect(countNonZero(scopes.vectorscope.cells)).toBeGreaterThan(6)
	})

	it('skips vectorscope work when vectorscope mode is disabled', () => {
		const clip = createClip({ color: '#ffffff' })
		const sampledFrame = createFrame(32, 16, (x, y) => [x * 8, 128, y * 12])
		const scopes = createPreviewScopeData([clip], { [clip.id]: sampledFrame }, {
			includeVectorscope: false,
			includeVectorscopePoints: false,
		})

		expect(countNonZero(scopes.waveform.cells)).toBeGreaterThan(20)
		expect(countNonZero(scopes.rgbParade.red)).toBeGreaterThan(20)
		expect(scopes.vectorscope.points).toHaveLength(0)
		expect(countNonZero(scopes.vectorscope.cells)).toBe(0)
	})

	it('computes only the requested scope section', () => {
		const clip = createClip({ color: '#ffffff' })
		const sampledFrame = createFrame(32, 16, (x, y) => [x * 8, 140, y * 12])

		const waveformOnly = createPreviewScopeData([clip], { [clip.id]: sampledFrame }, {
			includeWaveform: true,
			includeRgbParade: false,
			includeVectorscope: false,
			includeVectorscopePoints: false,
		})
		expect(countNonZero(waveformOnly.waveform.cells)).toBeGreaterThan(20)
		expect(countNonZero(waveformOnly.rgbParade.red)).toBe(0)
		expect(countNonZero(waveformOnly.vectorscope.cells)).toBe(0)

		const rgbOnly = createPreviewScopeData([clip], { [clip.id]: sampledFrame }, {
			includeWaveform: false,
			includeRgbParade: true,
			includeVectorscope: false,
			includeVectorscopePoints: false,
		})
		expect(countNonZero(rgbOnly.waveform.cells)).toBe(0)
		expect(countNonZero(rgbOnly.rgbParade.red)).toBeGreaterThan(20)
		expect(countNonZero(rgbOnly.vectorscope.cells)).toBe(0)
	})

	it('changes sampled density when color correction filters change', () => {
		const clip = createClip({ color: '#3344aa' })
		const sampledFrame = createFrame(16, 16, (x, y) => [40 + x * 8, 56 + y * 5, 170])
		const base = createPreviewScopeData([clip], { [clip.id]: sampledFrame })
		const gradedClip = createClip({ color: '#3344aa', filters: ['brightness(1.4) contrast(1.2) saturate(1.5) hue-rotate(24deg)'] })
		const graded = createPreviewScopeData([gradedClip], { [gradedClip.id]: sampledFrame })

		expect(graded.waveform.cells).not.toEqual(base.waveform.cells)
		expect(graded.rgbParade.red).not.toEqual(base.rgbParade.red)
		expect(graded.vectorscope.points[0]).not.toEqual(base.vectorscope.points[0])
	})
})