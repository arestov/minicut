import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { getAudioTrack, getClipIdsForTrack, getTracks, getVideoTrack } from '../domain/selectors'
import { CMD, type Entity, type ProjectRegistry } from '../domain/types'
import { compileEditframeClips, compileFrameOperations } from './renderPlan'

const createRenderedProject = (): { registry: ProjectRegistry, projectId: string, firstClipId: string, secondClipId: string } => {
	let registry = createEmptyRegistry()
	const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
	registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
	const projectId = String(createResult.createdIds?.projectId)

	const videoImport = buildDispatchResult(registry, {
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'Video', kind: 'video', duration: 4, url: 'file:///video.webm' },
	})
	registry = applyPatchEnvelopeToRegistry(registry, videoImport.envelope)
	const imageImport = buildDispatchResult(registry, {
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'Still', kind: 'image', duration: 1, url: 'file:///still.png' },
	})
	registry = applyPatchEnvelopeToRegistry(registry, imageImport.envelope)

	const firstClip = buildDispatchResult(registry, {
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId: String(videoImport.createdIds?.resourceId) },
	})
	registry = applyPatchEnvelopeToRegistry(registry, firstClip.envelope)
	const secondClip = buildDispatchResult(registry, {
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId: String(imageImport.createdIds?.resourceId) },
	})
	registry = applyPatchEnvelopeToRegistry(registry, secondClip.envelope)

	registry = applyPatchEnvelopeToRegistry(registry, buildDispatchResult(registry, {
		c: CMD.EFFECT_ADD,
		p: { id: String(firstClip.createdIds?.clipId), name: 'Blur', kind: 'blur', amount: 0.25 },
	}).envelope)
	registry = applyPatchEnvelopeToRegistry(registry, buildDispatchResult(registry, {
		c: CMD.EFFECT_ADD,
		p: { id: String(secondClip.createdIds?.clipId), name: 'Tint', kind: 'tint', amount: 0.35 },
	}).envelope)

	return {
		registry,
		projectId,
		firstClipId: String(firstClip.createdIds?.clipId),
		secondClipId: String(secondClip.createdIds?.clipId),
	}
}

describe('render plan compiler', () => {
	it('applies transform before effects and opacity in frame operations', () => {
		const { registry, projectId } = createRenderedProject()
		const [operation] = compileFrameOperations(registry, projectId, 0.5)

		expect(operation.operations.map((item) => item.type)).toEqual(['transform', 'effect', 'opacity'])
		expect(operation.operations[1]).toMatchObject({ type: 'effect', value: { kind: 'blur', amount: 0.25, enabled: true } })
	})

	it('is deterministic for the same registry and time input', () => {
		const { registry, projectId } = createRenderedProject()

		expect(compileFrameOperations(registry, projectId, 0.5)).toEqual(compileFrameOperations(registry, projectId, 0.5))
		expect(compileEditframeClips(registry, projectId)).toEqual(compileEditframeClips(registry, projectId))
	})

	it('compiles text clips into text draw operations without editframe media entries', () => {
		let { registry, projectId } = createRenderedProject()
		const textResult = buildDispatchResult(registry, {
			c: CMD.TEXT_ADD,
			p: { projectId, content: 'Overlay', start: 0.5, duration: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, textResult.envelope)
		registry = applyPatchEnvelopeToRegistry(registry, buildDispatchResult(registry, {
			c: CMD.TEXT_UPDATE_ATTRS,
			p: {
				id: String(textResult.createdIds?.textId),
				attrs: {
					style: {
						fontFamily: 'Inter, Segoe UI, sans-serif',
						fontSize: 64,
						fontWeight: 700,
						lineHeight: 1.1,
						letterSpacing: 0,
						color: '#f8fafc',
						backgroundColor: '#0f172a',
						align: 'center',
					},
				},
			},
		}).envelope)

		const textOperation = compileFrameOperations(registry, projectId, 0.75).find((operation) => operation.resourceKind === 'text')

		expect(textOperation).toBeDefined()
		expect(textOperation?.resourceId).toBe(textResult.createdIds?.textId)
		expect(textOperation?.operations.map((operation) => operation.type)).toEqual(['transform', 'text', 'opacity'])
		expect(textOperation?.operations.find((operation) => operation.type === 'text')?.value).toMatchObject({ content: 'Overlay', style: { color: '#f8fafc', backgroundColor: '#0f172a' } })
		expect(compileEditframeClips(registry, projectId).map((clip) => clip.id)).not.toContain(textResult.createdIds?.clipId)
	})

	it('does not leak effects between clips', () => {
		const { registry, projectId } = createRenderedProject()
		const project = registry.projects[projectId]
		const track = getVideoTrack(registry, project)
		expect(track).not.toBeNull()
		const [firstClipId, secondClipId] = getClipIdsForTrack(registry, String(track?.id))
		const firstEffects = compileFrameOperations(registry, projectId, 0.5).find((operation) => operation.clipId === firstClipId)?.operations
		const secondEffects = compileFrameOperations(registry, projectId, 4.5).find((operation) => operation.clipId === secondClipId)?.operations

		expect(firstEffects).toContainEqual(expect.objectContaining({ type: 'effect', value: expect.objectContaining({ kind: 'blur' }) }))
		expect(firstEffects).not.toContainEqual(expect.objectContaining({ type: 'effect', value: expect.objectContaining({ kind: 'tint' }) }))
		expect(secondEffects).toContainEqual(expect.objectContaining({ type: 'effect', value: expect.objectContaining({ kind: 'tint' }) }))
		expect(secondEffects).not.toContainEqual(expect.objectContaining({ type: 'effect', value: expect.objectContaining({ kind: 'blur' }) }))
	})

	it('evaluates clip-local opacity and transform keyframes in frame operations', () => {
		const { registry, projectId, firstClipId } = createRenderedProject()
		const opacityStartId = 'keyframe:opacity-start'
		const opacityEndId = 'keyframe:opacity-end'
		const xStartId = 'keyframe:x-start'
		const xEndId = 'keyframe:x-end'
		const keyframes: Entity[] = [
			{ id: opacityStartId, type: 'keyframe', attrs: { time: 0, value: 1 }, rels: {} },
			{ id: opacityEndId, type: 'keyframe', attrs: { time: 4, value: 0.2 }, rels: {} },
			{ id: xStartId, type: 'keyframe', attrs: { time: 0, value: 0 }, rels: {} },
			{ id: xEndId, type: 'keyframe', attrs: { time: 4, value: 80 }, rels: {} },
		]

		for (const keyframe of keyframes) {
			registry.entitiesById[keyframe.id] = keyframe
		}
		registry.entitiesById[firstClipId].attrs.opacity = { value: 1, keyframes: [opacityStartId, opacityEndId] }
		registry.entitiesById[firstClipId].attrs.transform = {
			...(registry.entitiesById[firstClipId].attrs.transform as object),
			x: { value: 0, keyframes: [xStartId, xEndId] },
		}

		const [operation] = compileFrameOperations(registry, projectId, 2)
		const transform = operation.operations.find((item) => item.type === 'transform')?.value
		const opacity = operation.operations.find((item) => item.type === 'opacity')?.value

		expect(operation.localTime).toBe(2)
		expect(operation.sourceTime).toBe(2)
		expect(transform).toMatchObject({ x: 40, y: 0, scale: 1, rotation: 0 })
		expect(opacity).toBeCloseTo(0.6, 6)
	})

	it('applies clip fades to evaluated opacity', () => {
		const { registry, projectId, firstClipId } = createRenderedProject()
		registry.entitiesById[firstClipId].attrs.fadeIn = 1
		registry.entitiesById[firstClipId].attrs.fadeOut = 1

		const fadeInOpacity = compileFrameOperations(registry, projectId, 0.5)[0].operations.find((item) => item.type === 'opacity')?.value
		const middleOpacity = compileFrameOperations(registry, projectId, 2)[0].operations.find((item) => item.type === 'opacity')?.value
		const fadeOutOpacity = compileFrameOperations(registry, projectId, 3.5)[0].operations.find((item) => item.type === 'opacity')?.value

		expect(fadeInOpacity).toBeCloseTo(0.5, 6)
		expect(middleOpacity).toBe(1)
		expect(fadeOutOpacity).toBeCloseTo(0.5, 6)
	})

	it('exports valid editframe clip structure with timeline mapping', () => {
		const { registry, projectId } = createRenderedProject()
		const clips = compileEditframeClips(registry, projectId)
		const trackCount = getTracks(registry, registry.projects[projectId]).flatMap((track) => getClipIdsForTrack(registry, track.id)).length

		expect(clips).toHaveLength(trackCount)
		expect(clips[0]).toMatchObject({ type: 'ef-video', source: 'file:///video.webm', start: 0, duration: 4, trimStart: 0 })
		expect(clips[1]).toMatchObject({ type: 'ef-image', source: 'file:///still.png', start: 4, duration: 1, trimStart: 0 })
	})

	it('excludes muted tracks from frame operations and export source clips', () => {
		const { registry, projectId } = createRenderedProject()
		const project = registry.projects[projectId]
		const videoTrack = getVideoTrack(registry, project)
		expect(videoTrack).not.toBeNull()
		registry.entitiesById[String(videoTrack?.id)].attrs.muted = true

		expect(compileFrameOperations(registry, projectId, 0.5)).toEqual([])
		expect(compileEditframeClips(registry, projectId)).toEqual([])
	})

	it('compiles linked video audio clips with audio gain and pan for preview and export', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Camera take', kind: 'video', duration: 3, url: 'file:///camera.webm' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)
		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId), includeLinkedAudio: true },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const project = registry.projects[projectId]
		const audioTrack = getAudioTrack(registry, project)
		const audioClipId = getClipIdsForTrack(registry, String(audioTrack?.id))[0]
		registry.entitiesById[audioClipId].attrs.audio = { gain: 0.65, pan: -0.4 }

		const frameOperations = compileFrameOperations(registry, projectId, 0.5)
		const audioOperation = frameOperations.find((operation) => operation.clipId === audioClipId)
		expect(audioOperation).toMatchObject({ resourceKind: 'audio', sourceTime: 0.5 })
		expect(audioOperation?.operations).toContainEqual({ type: 'audio', value: { gain: 0.65, pan: -0.4 } })

		const editframeAudioClip = compileEditframeClips(registry, projectId).find((clip) => clip.id === audioClipId)
		expect(editframeAudioClip).toMatchObject({ type: 'ef-audio', source: 'file:///camera.webm', gain: 0.65, pan: -0.4 })
	})
})
