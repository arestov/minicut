import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { CMD, type Entity, type ProjectRegistry, type ResourceAttrs } from '../domain/types'
import {
	createBrowserVideoExportRenderer,
	createManifestExportRenderer,
	getFramePacingDelayMs,
	shouldSeekRealtimeVideoFrame,
	type ExportRange,
} from './exportRenderer'

const createProjectWithClip = (kind: ResourceAttrs['kind']): { registry: ProjectRegistry; projectId: string; clipId: string } => {
	let registry = createEmptyRegistry()
	const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: { title: `${kind} export` } })
	registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
	const projectId = String(createResult.createdIds?.projectId)

	const importResult = buildDispatchResult(registry, {
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: `${kind} source`, kind, duration: 2, url: `file:///${kind}.dat` },
	})
	registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

	const clipResult = buildDispatchResult(registry, {
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
	})
	registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

	return { registry, projectId, clipId: String(clipResult.createdIds?.clipId) }
}

const rangeCases: Array<{ kind: ResourceAttrs['kind']; rangeType: ExportRange['type']; editframeType: string }> = [
	{ kind: 'video', rangeType: 'project', editframeType: 'ef-video' },
	{ kind: 'video', rangeType: 'clip', editframeType: 'ef-video' },
	{ kind: 'image', rangeType: 'project', editframeType: 'ef-image' },
	{ kind: 'image', rangeType: 'clip', editframeType: 'ef-image' },
	{ kind: 'audio', rangeType: 'project', editframeType: 'ef-audio' },
	{ kind: 'audio', rangeType: 'clip', editframeType: 'ef-audio' },
]

describe('manifest export renderer', () => {
	it('keeps trailing image frames after a short clip trimmed from a large video source', async () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: { title: 'trim export' } })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const videoImport = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Long source', kind: 'video', duration: 120, url: 'file:///long.webm' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, videoImport.envelope)
		const imageImport = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'End card', kind: 'image', duration: 1, url: 'file:///end.png' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, imageImport.envelope)
		const videoClipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(videoImport.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, videoClipResult.envelope)
		const imageClipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(imageImport.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, imageClipResult.envelope)
		const videoClipId = String(videoClipResult.createdIds?.clipId)
		const imageClipId = String(imageClipResult.createdIds?.clipId)
		registry.entitiesById[videoClipId].attrs.in = 80
		registry.entitiesById[videoClipId].attrs.duration = 2
		registry.entitiesById[imageClipId].attrs.start = 2
		registry.entitiesById[imageClipId].attrs.duration = 1

		const result = await createManifestExportRenderer().render({
			registry,
			projectId,
			range: { type: 'project' },
			fps: 2,
		})

		expect(result.duration).toBe(3)
		expect(result.manifest.frames).toHaveLength(6)
		expect(result.manifest.frames[0].operations[0]).toMatchObject({
			clipId: videoClipId,
			resourceKind: 'video',
			sourceTime: 80,
		})
		expect(result.manifest.frames.slice(4).flatMap((frame) => frame.operations)).toEqual([
			expect.objectContaining({ clipId: imageClipId, resourceKind: 'image' }),
			expect.objectContaining({ clipId: imageClipId, resourceKind: 'image' }),
		])
	})

	it.each(rangeCases)('exports $kind media for $rangeType ranges', async ({ kind, rangeType, editframeType }) => {
		const { registry, projectId, clipId } = createProjectWithClip(kind)
		const renderer = createManifestExportRenderer()
		const progress: string[] = []
		const range: ExportRange = rangeType === 'clip' ? { type: 'clip', clipId } : { type: 'project' }

		const result = await renderer.render({ registry, projectId, range, fps: 2 }, (event) => {
			progress.push(event.stage)
		})

		expect(result.fileName).toMatch(/export\.json$/)
		expect(result.mimeType).toBe('application/vnd.minicut.export+json')
		expect(result.duration).toBe(2)
		expect(result.frameCount).toBe(4)
		expect(result.manifest.clips).toHaveLength(1)
		expect(result.manifest.clips[0]).toMatchObject({ type: editframeType, id: clipId, duration: 2 })
		expect(result.manifest.frames).toHaveLength(4)
		expect(result.manifest.frames[0].operations[0]).toMatchObject({ clipId, resourceKind: kind })
		expect(await result.blob.text()).toContain('"frameCount": 4')
		expect(progress[0]).toBe('queued')
		expect(progress).toContain('rendering')
		expect(progress.at(-1)).toBe('done')
	})

	it('writes evaluated keyframed scalar values into exported frame samples', async () => {
		const { registry, projectId, clipId } = createProjectWithClip('video')
		const keyframes: Entity[] = [
			{ id: 'keyframe:opacity-0', type: 'keyframe', attrs: { time: 0, value: 1 }, rels: {} },
			{ id: 'keyframe:opacity-1', type: 'keyframe', attrs: { time: 2, value: 0 }, rels: {} },
			{ id: 'keyframe:x-0', type: 'keyframe', attrs: { time: 0, value: 0 }, rels: {} },
			{ id: 'keyframe:x-1', type: 'keyframe', attrs: { time: 2, value: 20 }, rels: {} },
		]
		for (const keyframe of keyframes) {
			registry.entitiesById[keyframe.id] = keyframe
		}
		registry.entitiesById[clipId].attrs.opacity = { value: 1, keyframes: ['keyframe:opacity-0', 'keyframe:opacity-1'] }
		registry.entitiesById[clipId].attrs.transform = {
			...(registry.entitiesById[clipId].attrs.transform as object),
			x: { value: 0, keyframes: ['keyframe:x-0', 'keyframe:x-1'] },
		}

		const result = await createManifestExportRenderer().render({
			registry,
			projectId,
			range: { type: 'clip', clipId },
			fps: 2,
		})
		const middleOperations = result.manifest.frames[2].operations[0].operations
		const transform = middleOperations.find((operation) => operation.type === 'transform')?.value
		const opacity = middleOperations.find((operation) => operation.type === 'opacity')?.value

		expect(transform).toMatchObject({ x: 10, y: 0, scale: 1, rotation: 0 })
		expect(opacity).toBe(0.5)
	})

	it('writes fade-adjusted opacity into exported frame samples', async () => {
		const { registry, projectId, clipId } = createProjectWithClip('video')
		registry.entitiesById[clipId].attrs.fadeIn = 1
		registry.entitiesById[clipId].attrs.fadeOut = 1

		const result = await createManifestExportRenderer().render({
			registry,
			projectId,
			range: { type: 'clip', clipId },
			fps: 2,
		})
		const frameOpacities = result.manifest.frames.map((frame) =>
			frame.operations[0].operations.find((operation) => operation.type === 'opacity')?.value,
		)

		expect(frameOpacities).toEqual([0, 0.5, 1, 0.5])
	})

	it('exports linked video audio clips with audio settings in project manifests', async () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: { title: 'linked audio export' } })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Camera take', kind: 'video', duration: 2, url: 'file:///camera.webm' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)
		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId), includeLinkedAudio: true },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const audioClipId = String(clipResult.createdIds?.audioClipId)
		registry.entitiesById[audioClipId].attrs.audio = { gain: 0.7, pan: 0.25 }

		const result = await createManifestExportRenderer().render({ registry, projectId, range: { type: 'project' }, fps: 2 })

		expect(result.manifest.clips).toEqual(expect.arrayContaining([
			expect.objectContaining({ type: 'ef-video', id: String(clipResult.createdIds?.clipId) }),
			expect.objectContaining({ type: 'ef-audio', id: audioClipId, gain: 0.7, pan: 0.25 }),
		]))
		expect(result.manifest.frames[0].operations).toEqual(expect.arrayContaining([
			expect.objectContaining({ clipId: audioClipId, resourceKind: 'audio' }),
		]))
	})

	it('records linked audio clip ids in selected video export diagnostics', async () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: { title: 'selected linked diagnostics' } })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Camera take', kind: 'video', duration: 2, url: 'file:///camera.webm' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)
		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId), includeLinkedAudio: true },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const videoClipId = String(clipResult.createdIds?.clipId)
		const audioClipId = String(clipResult.createdIds?.audioClipId)

		const result = await createManifestExportRenderer().render({ registry, projectId, range: { type: 'clip', clipId: videoClipId }, fps: 2 })

		expect(result.manifest.clips).toEqual(expect.arrayContaining([
			expect.objectContaining({ type: 'ef-video', id: videoClipId }),
			expect.objectContaining({ type: 'ef-audio', id: audioClipId }),
		]))
		expect(result.diagnostics).toMatchObject({ backend: 'manifest' })
		expect(result.diagnostics?.resolvedClipIds).toEqual(expect.arrayContaining([videoClipId, audioClipId]))
		expect(result.manifest.diagnostics?.resolvedClipIds).toEqual(expect.arrayContaining([videoClipId, audioClipId]))
	})
})

describe('browser video export renderer', () => {
	it('does not seek realtime video playback while it remains within frame tolerance', () => {
		expect(shouldSeekRealtimeVideoFrame(80, 80, 0.08)).toBe(false)
		expect(shouldSeekRealtimeVideoFrame(80.03, 80, 0.08)).toBe(false)
		expect(shouldSeekRealtimeVideoFrame(79.5, 80, 0.08)).toBe(true)
	})

	it('paces recorded frames against target export time instead of adding render work time', () => {
		expect(getFramePacingDelayMs(1000, 0, 25, 1010)).toBe(30)
		expect(getFramePacingDelayMs(1000, 0, 25, 1045)).toBe(0)
		expect(getFramePacingDelayMs(1000, 4, 25, 1100)).toBe(100)
	})

	it('falls back to json manifest when video export is unsupported', async () => {
		const { registry, projectId, clipId } = createProjectWithClip('video')
		const renderer = createBrowserVideoExportRenderer({ fallbackToManifestOnUnsupported: true })

		const result = await renderer.render({
			registry,
			projectId,
			range: { type: 'clip', clipId },
			format: 'video-webm',
			fps: 2,
		})

		expect(result.mimeType).toBe('application/vnd.minicut.export+json')
		expect(result.fileName).toMatch(/\.minicut-export\.json$/)
		expect(result.manifest.format).toBe('json-manifest')
		expect(result.manifest.frames.length).toBeGreaterThan(0)
		expect(result.diagnostics).toMatchObject({
			backend: 'manifest',
			fallbackReason: 'webcodecs-video-unsupported',
		})
		expect(result.diagnostics?.resolvedClipIds).toEqual([clipId])
		expect(result.manifest.diagnostics).toEqual(result.diagnostics)
		expect(await result.blob.text()).toContain('webcodecs-video-unsupported')
	})

	it('throws when video export is unsupported and fallback is disabled', async () => {
		const { registry, projectId } = createProjectWithClip('video')
		const renderer = createBrowserVideoExportRenderer({ fallbackToManifestOnUnsupported: false })

		await expect(renderer.render({
			registry,
			projectId,
			range: { type: 'project' },
			format: 'video-webm',
			fps: 2,
		})).rejects.toThrow('Video export is not supported in this environment')
	})
})
