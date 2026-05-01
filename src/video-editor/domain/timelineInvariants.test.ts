import { buildDispatchResult } from './applyCommand'
import { applyPatchEnvelopeToRegistry } from './applyPatch'
import { createEmptyRegistry } from './createProject'
import {
	getActiveClipNamesAtCursor,
	getClipEntitiesForTrack,
	getClipIdsForTrack,
	getTracks,
	getVideoTrack,
} from './selectors'
import { CMD, type ClipAttrs, type Entity, type ProjectRegistry, type ResourceAttrs } from './types'

const createProjectWithClip = (duration = 8): { registry: ProjectRegistry, projectId: string, clipId: string } => {
	let registry = createEmptyRegistry()
	const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
	registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
	const projectId = String(createResult.createdIds?.projectId)

	const importResult = buildDispatchResult(registry, {
		c: CMD.RESOURCE_IMPORT,
		p: { projectId, name: 'Invariant source', kind: 'video', duration },
	})
	registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

	const clipResult = buildDispatchResult(registry, {
		c: CMD.TIMELINE_ADD_CLIP,
		p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
	})
	registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

	return { registry, projectId, clipId: String(clipResult.createdIds?.clipId) }
}

const getResourceDuration = (registry: ProjectRegistry, clip: Entity): number => {
	const resourceId = String(clip.rels.resource)
	return (registry.entitiesById[resourceId].attrs as unknown as ResourceAttrs).duration
}

const expectClipInvariants = (registry: ProjectRegistry): void => {
	for (const entity of Object.values(registry.entitiesById)) {
		if (entity.type !== 'clip') {
			continue
		}

		const attrs = entity.attrs as unknown as ClipAttrs
		expect(Number.isFinite(attrs.start)).toBe(true)
		expect(Number.isFinite(attrs.duration)).toBe(true)
		expect(Number.isFinite(attrs.in)).toBe(true)
		expect(attrs.start).toBeGreaterThanOrEqual(0)
		expect(attrs.duration).toBeGreaterThan(0)
		expect(attrs.in).toBeGreaterThanOrEqual(0)
		expect(attrs.in).toBeLessThanOrEqual(getResourceDuration(registry, entity))
	}
}

describe('timeline invariants', () => {
	it('keeps active clip calculation consistent across time boundaries', () => {
		let { registry, projectId, clipId } = createProjectWithClip(4)
		const splitResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_SPLIT_CLIP,
			p: { id: clipId, time: 1.5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, splitResult.envelope)
		const project = registry.projects[projectId]
		const track = getVideoTrack(registry, project)
		expect(track).not.toBeNull()
		const trackClips = getClipEntitiesForTrack(registry, String(track?.id))

		for (const time of [-0.01, 0, 1.49, 1.5, 3.99, 4, 4.01]) {
			const expectedNames = trackClips
				.filter((clip) => {
					const attrs = clip.attrs as unknown as ClipAttrs
					return time >= attrs.start && time < attrs.start + attrs.duration
				})
				.map((clip) => String((clip.attrs as unknown as ClipAttrs).name))
			const actualNames = getActiveClipNamesAtCursor(registry, { activeProjectId: projectId, cursor: time })

			expect(actualNames).toEqual(expectedNames)
			expect(new Set(actualNames).size).toBe(actualNames.length)
		}
	})

	it('keeps clip duration positive and in point within source after trim split and delete', () => {
		let { registry, clipId } = createProjectWithClip(5)
		const trimResult = buildDispatchResult(registry, {
			c: CMD.CLIP_UPDATE_ATTRS,
			p: { id: clipId, attrs: { start: 1, in: 1, duration: 4 } },
		})
		registry = applyPatchEnvelopeToRegistry(registry, trimResult.envelope)
		expectClipInvariants(registry)

		const splitResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_SPLIT_CLIP,
			p: { id: clipId, time: 2.25 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, splitResult.envelope)
		expectClipInvariants(registry)

		const deleteResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_DELETE_CLIP,
			p: { id: String(splitResult.createdIds?.clipId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, deleteResult.envelope)
		expectClipInvariants(registry)
	})

	it('split preserves total duration and source mapping', () => {
		let { registry, projectId, clipId } = createProjectWithClip(7)
		const originalAttrs = registry.entitiesById[clipId].attrs as unknown as ClipAttrs
		const splitAt = 2.75
		const splitResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_SPLIT_CLIP,
			p: { id: clipId, time: splitAt },
		})
		registry = applyPatchEnvelopeToRegistry(registry, splitResult.envelope)

		const project = registry.projects[projectId]
		const track = getVideoTrack(registry, project)
		expect(track).not.toBeNull()
		const [leftId, rightId] = getClipIdsForTrack(registry, String(track?.id))
		const leftAttrs = registry.entitiesById[leftId].attrs as unknown as ClipAttrs
		const rightAttrs = registry.entitiesById[rightId].attrs as unknown as ClipAttrs

		expect(leftAttrs.duration + rightAttrs.duration).toBeCloseTo(originalAttrs.duration, 6)
		expect(rightAttrs.start).toBe(splitAt)
		expect(rightAttrs.in).toBeCloseTo(originalAttrs.in + leftAttrs.duration, 6)
		expect(rightAttrs.name).toBe(originalAttrs.name)
		expect(registry.entitiesById[rightId].rels.resource).toBe(registry.entitiesById[leftId].rels.resource)
	})
})
