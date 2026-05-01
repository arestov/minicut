import { buildDispatchResult } from '../domain/applyCommand'
import { applyPatchEnvelopeToRegistry } from '../domain/applyPatch'
import { createEmptyRegistry } from '../domain/createProject'
import { CMD, type Entity, type ProjectRegistry, type ResourceAttrs } from '../domain/types'
import { createBrowserVideoExportRenderer, createManifestExportRenderer, type ExportRange } from './exportRenderer'

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
})

describe('browser video export renderer', () => {
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
