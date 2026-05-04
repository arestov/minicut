import { describe, expect, it } from 'vitest'
import type { RenderedClip } from '../legend/derivedTimeline'
import { createPreviewScopeData } from './colorScopes'

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

describe('color scopes', () => {
	it('returns empty scope data without visual clips', () => {
		const scopes = createPreviewScopeData([])

		expect(scopes.clipCount).toBe(0)
		expect(scopes.waveform.buckets.every((value) => value === 0)).toBe(true)
		expect(scopes.rgbParade.red.every((value) => value === 0)).toBe(true)
		expect(scopes.vectorscope.points).toEqual([])
	})

	it('ignores audio clips when building visual scopes', () => {
		const scopes = createPreviewScopeData([createClip({ resourceKind: 'audio' })])

		expect(scopes.clipCount).toBe(0)
		expect(scopes.vectorscope.points).toEqual([])
	})

	it('changes scope buckets when color correction filters change', () => {
		const base = createPreviewScopeData([createClip({ color: '#3344aa' })])
		const graded = createPreviewScopeData([
			createClip({ color: '#3344aa', filters: ['brightness(3) contrast(1) saturate(1.5) hue-rotate(12deg)'] }),
		])

		expect(graded.waveform.buckets).not.toEqual(base.waveform.buckets)
		expect(graded.rgbParade.red).not.toEqual(base.rgbParade.red)
		expect(graded.vectorscope.points[0]).not.toEqual(base.vectorscope.points[0])
	})
})