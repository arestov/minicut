import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { getClipIdsForTrack, getTracks, getVideoTrack } from '../domain/selectors'
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
		expect(operation.operations[1]).toEqual({ type: 'effect', value: 'blur' })
	})

	it('is deterministic for the same registry and time input', () => {
		const { registry, projectId } = createRenderedProject()

		expect(compileFrameOperations(registry, projectId, 0.5)).toEqual(compileFrameOperations(registry, projectId, 0.5))
		expect(compileEditframeClips(registry, projectId)).toEqual(compileEditframeClips(registry, projectId))
	})

	it('does not leak effects between clips', () => {
		const { registry, projectId } = createRenderedProject()
		const project = registry.projects[projectId]
		const track = getVideoTrack(registry, project)
		expect(track).not.toBeNull()
		const [firstClipId, secondClipId] = getClipIdsForTrack(registry, String(track?.id))
		const firstEffects = compileFrameOperations(registry, projectId, 0.5).find((operation) => operation.clipId === firstClipId)?.operations
		const secondEffects = compileFrameOperations(registry, projectId, 4.5).find((operation) => operation.clipId === secondClipId)?.operations

		expect(firstEffects).toContainEqual({ type: 'effect', value: 'blur' })
		expect(firstEffects).not.toContainEqual({ type: 'effect', value: 'tint' })
		expect(secondEffects).toContainEqual({ type: 'effect', value: 'tint' })
		expect(secondEffects).not.toContainEqual({ type: 'effect', value: 'blur' })
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

	it('exports valid editframe clip structure with timeline mapping', () => {
		const { registry, projectId } = createRenderedProject()
		const clips = compileEditframeClips(registry, projectId)
		const trackCount = getTracks(registry, registry.projects[projectId]).flatMap((track) => getClipIdsForTrack(registry, track.id)).length

		expect(clips).toHaveLength(trackCount)
		expect(clips[0]).toMatchObject({ type: 'ef-video', source: 'file:///video.webm', start: 0, duration: 4, trimStart: 0 })
		expect(clips[1]).toMatchObject({ type: 'ef-image', source: 'file:///still.png', start: 4, duration: 1, trimStart: 0 })
	})
})
