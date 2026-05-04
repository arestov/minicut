import { buildDispatchResult } from './applyCommand'
import { applyPatchEnvelopeToRegistry } from './applyPatch'
import { createEmptyRegistry } from './createProject'
import { getClipIdsForTrack, getVideoTrack } from './selectors'
import { CMD, type ProjectRegistry, type TextAttrs } from './types'

const createProject = (): { registry: ProjectRegistry; projectId: string } => {
	let registry = createEmptyRegistry()
	const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
	registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)

	return { registry, projectId: String(createResult.createdIds?.projectId) }
}

describe('text editing domain', () => {
	it('creates a text entity and linked text clip on the video track', () => {
		let { registry, projectId } = createProject()
		const result = buildDispatchResult(registry, { c: CMD.TEXT_ADD, p: { projectId, content: 'Launch title', duration: 3 } })
		registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
		const clipId = String(result.createdIds?.clipId)
		const textId = String(result.createdIds?.textId)
		const clip = registry.entitiesById[clipId]
		const text = registry.entitiesById[textId]
		const track = getVideoTrack(registry, registry.projects[projectId])

		expect(text.type).toBe('text')
		expect((text.attrs as unknown as TextAttrs).content).toBe('Launch title')
		expect(clip.attrs.mediaKind).toBe('text')
		expect(clip.rels.text).toBe(textId)
		expect(getClipIdsForTrack(registry, String(track?.id))).toContain(clipId)
	})

	it('updates text content and style attrs independently from clip timing', () => {
		let { registry, projectId } = createProject()
		const add = buildDispatchResult(registry, { c: CMD.TEXT_ADD, p: { projectId, content: 'Before' } })
		registry = applyPatchEnvelopeToRegistry(registry, add.envelope)
		const clipId = String(add.createdIds?.clipId)
		const textId = String(add.createdIds?.textId)
		const update = buildDispatchResult(registry, {
			c: CMD.TEXT_UPDATE_ATTRS,
			p: {
				id: textId,
				attrs: {
					content: 'After',
					style: {
						fontFamily: 'Inter, sans-serif',
						fontSize: 88,
						fontWeight: 800,
						lineHeight: 1.15,
						letterSpacing: 0,
						color: '#f8fafc',
						align: 'center',
					},
				},
			},
		})
		registry = applyPatchEnvelopeToRegistry(registry, update.envelope)
		const attrs = registry.entitiesById[textId].attrs as unknown as TextAttrs

		expect(attrs.content).toBe('After')
		expect(attrs.style.fontSize).toBe(88)
		expect(registry.entitiesById[clipId].attrs.duration).toBe(5)
	})

	it('rejects text clips on audio tracks', () => {
		const { registry, projectId } = createProject()
		const audioTrack = Object.values(registry.entitiesById).find((entity) => entity.type === 'track' && entity.attrs.kind === 'audio')

		expect(() => buildDispatchResult(registry, {
			c: CMD.TEXT_ADD,
			p: { projectId, trackId: String(audioTrack?.id), content: 'Bad track' },
		})).toThrow('Text clips must target a video track')
	})
})
