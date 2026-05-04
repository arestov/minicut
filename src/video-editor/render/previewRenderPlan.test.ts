import { describe, expect, it } from 'vitest'
import type { PreviewFrame, RenderedClip } from '../legend/derivedTimeline'
import { compilePreviewRenderPlan, getPreviewOperationValue } from './previewRenderPlan'

const createClip = (overrides: Partial<RenderedClip> = {}): RenderedClip => ({
	id: 'clip:1',
	resourceId: 'resource:1',
	name: 'Clip',
	color: '#2563eb',
	resourceName: 'source.webm',
	resourceKind: 'video',
	resourceUrl: 'blob:source',
	mime: 'video/webm',
	inPoint: 0.5,
	start: 1,
	opacity: 0.8,
	transform: { x: 10, y: 20, scale: 1.2, rotation: 5 },
	audio: { gain: 1, pan: 0 },
	filters: ['brightness(1.1)', 'contrast(1.2)'],
	text: null,
	...overrides,
})

const createFrame = (clips: RenderedClip[]): PreviewFrame => ({
	cursor: 1.5,
	renderedClips: clips,
	visualRenderedClips: clips.filter((clip) => clip.resourceKind !== 'audio'),
	audioRenderedClips: clips.filter((clip) => clip.resourceKind === 'audio'),
	activeClipNames: clips.map((clip) => clip.name),
})

describe('preview render plan', () => {
	it('serializes visual layer operations for renderer consumption', () => {
		const plan = compilePreviewRenderPlan(createFrame([createClip()]))
		const [layer] = plan.visualLayers

		expect(plan.cursor).toBe(1.5)
		expect(layer).toMatchObject({ clipId: 'clip:1', resourceKind: 'video', sourceTime: 0.5 })
		expect(getPreviewOperationValue(layer.operations, 'transform', null)).toMatchObject({ x: 10, y: 20, scale: 1.2, rotation: 5 })
		expect(getPreviewOperationValue(layer.operations, 'effect', [])).toEqual(['brightness(1.1)', 'contrast(1.2)'])
		expect(getPreviewOperationValue(layer.operations, 'opacity', 1)).toBe(0.8)
	})

	it('serializes text styles so preview tests do not need DOM rendering', () => {
		const textClip = createClip({
			resourceId: null,
			resourceKind: 'text',
			resourceUrl: '',
			text: {
				content: 'Title',
				style: {
					fontFamily: 'Inter',
					fontSize: 64,
					fontWeight: 700,
					lineHeight: 1.1,
					letterSpacing: 0,
					color: '#f8fafc',
					backgroundColor: '#0f172a',
					align: 'center',
				},
				box: { width: 760, height: 220 },
			},
			filters: [],
		})
		const [layer] = compilePreviewRenderPlan(createFrame([textClip])).visualLayers

		expect(getPreviewOperationValue(layer.operations, 'text', null)).toMatchObject({
			content: 'Title',
			style: { color: '#f8fafc', backgroundColor: '#0f172a' },
		})
	})
})
