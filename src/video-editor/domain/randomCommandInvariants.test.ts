import { buildDispatchResult } from './applyCommand'
import { applyPatchEnvelopeToRegistry } from './applyPatch'
import { createEmptyRegistry } from './createProject'
import {
	getClipEntitiesForTrack,
	getClipIdsForTrack,
	getProjectEntity,
	getResourceEntities,
	getTracks,
	getVideoTrack,
} from './selectors'
import { CMD, type ClipAttrs, type Entity, type EntityId, type ProjectGraph, type ProjectRegistry, type ResourceAttrs } from './types'

const createRandom = (seed: number) => {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x100000000
	}
}

const pick = <T>(items: T[], random: () => number): T | null =>
	items.length === 0 ? null : items[Math.floor(random() * items.length)]

const asIds = (value: Entity['rels'][string]): EntityId[] => {
	if (Array.isArray(value)) {
		return value
	}
	return value ? [value] : []
}

const reachableEntityIds = (registry: ProjectRegistry, project: ProjectGraph): Set<EntityId> => {
	const reachable = new Set<EntityId>()
	const queue: EntityId[] = [project.rootEntityId]

	while (queue.length > 0) {
		const entityId = queue.pop() as EntityId
		if (reachable.has(entityId)) {
			continue
		}

		reachable.add(entityId)
		const entity = registry.entitiesById[entityId]
		if (!entity) {
			continue
		}

		for (const relValue of Object.values(entity.rels)) {
			for (const relId of asIds(relValue)) {
				queue.push(relId)
			}
		}
	}

	return reachable
}

const assertProjectInvariants = (registry: ProjectRegistry, projectId: string): void => {
	const project = registry.projects[projectId]
	expect(project).toBeTruthy()
	const projectEntity = getProjectEntity(registry, project)
	expect(projectEntity.type).toBe('project')

	for (const entity of Object.values(registry.entitiesById)) {
		for (const relValue of Object.values(entity.rels)) {
			for (const relId of asIds(relValue)) {
				expect(registry.entitiesById[relId], `${entity.id} references missing ${relId}`).toBeTruthy()
			}
		}

		for (const value of Object.values(entity.attrs)) {
			if (typeof value === 'number') {
				expect(Number.isFinite(value), `${entity.id} has non-finite attr`).toBe(true)
			}
		}

		if (entity.type === 'clip') {
			const attrs = entity.attrs as unknown as ClipAttrs
			expect(attrs.duration).toBeGreaterThan(0)
			expect(attrs.start).toBeGreaterThanOrEqual(0)
			expect(attrs.in).toBeGreaterThanOrEqual(0)
			const resource = registry.entitiesById[String(entity.rels.resource)]
			expect(resource?.type).toBe('resource')
			expect(attrs.in).toBeLessThanOrEqual((resource.attrs as unknown as ResourceAttrs).duration)
		}

		if (entity.type === 'effect') {
			const clip = registry.entitiesById[String(entity.rels.clip)]
			expect(clip?.type).toBe('clip')
			expect(asIds(clip.rels.effects)).toContain(entity.id)
		}
	}

	const reachable = reachableEntityIds(registry, project)
	for (const entityId of Object.keys(registry.entitiesById)) {
		expect(reachable.has(entityId), `${entityId} is dangling`).toBe(true)
	}
}

describe('random command invariants', () => {
	it('keeps project graph valid across deterministic random command sequences', () => {
		const random = createRandom(42)
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		for (let step = 0; step < 100; step += 1) {
			const project = registry.projects[projectId]
			const resources = getResourceEntities(registry, project)
			const tracks = getTracks(registry, project)
			const clips = tracks.flatMap((track) => getClipEntitiesForTrack(registry, track.id))
			const choice = Math.floor(random() * 8)

			if (choice === 0 || resources.length === 0) {
				const kind = choice % 3 === 0 ? 'video' : choice % 3 === 1 ? 'audio' : 'image'
				const result = buildDispatchResult(registry, {
					c: CMD.RESOURCE_IMPORT,
					p: { projectId, name: `Resource ${step}`, kind, duration: kind === 'image' ? 1 : 1 + Math.floor(random() * 8) },
				})
				registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				assertProjectInvariants(registry, projectId)
				continue
			}

			if (choice === 1) {
				const resource = pick(resources, random)
				const targetTrack = resource?.attrs.kind === 'audio'
					? tracks.find((track) => track.attrs.kind === 'audio')
					: getVideoTrack(registry, project)
				if (resource && targetTrack) {
					const result = buildDispatchResult(registry, {
						c: CMD.TIMELINE_ADD_CLIP,
						p: { projectId, resourceId: resource.id, trackId: targetTrack.id },
					})
					registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				}
			} else if (choice === 2 && clips.length > 0) {
				const clip = pick(clips, random)
				if (clip) {
					const result = buildDispatchResult(registry, {
						c: CMD.TIMELINE_MOVE_CLIP,
						p: { id: clip.id, delta: Math.round((random() * 4 - 2) * 10) / 10 },
					})
					registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				}
			} else if (choice === 3 && clips.length > 0) {
				const clip = pick(clips, random)
				const attrs = clip?.attrs as unknown as ClipAttrs | undefined
				if (clip && attrs && attrs.duration > 0.75) {
					const nextStart = attrs.start + 0.25
					const result = buildDispatchResult(registry, {
						c: CMD.CLIP_UPDATE_ATTRS,
						p: { id: clip.id, attrs: { start: nextStart, in: attrs.in + 0.25, duration: attrs.duration - 0.25 } },
					})
					registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				}
			} else if (choice === 4 && clips.length > 0) {
				const clip = pick(clips, random)
				const attrs = clip?.attrs as unknown as ClipAttrs | undefined
				if (clip && attrs && attrs.duration > 0.5) {
					const result = buildDispatchResult(registry, {
						c: CMD.TIMELINE_SPLIT_CLIP,
						p: { id: clip.id, time: attrs.start + attrs.duration / 2 },
					})
					registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				}
			} else if (choice === 5 && clips.length > 0) {
				const clip = pick(clips, random)
				if (clip) {
					const result = buildDispatchResult(registry, {
						c: CMD.EFFECT_ADD,
						p: { id: clip.id, name: 'Random Blur', kind: 'blur', amount: 0.2 },
					})
					registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				}
			} else if (choice === 6 && clips.length > 0) {
				const clip = pick(clips, random)
				const effectId = pick(asIds(clip?.rels.effects ?? []), random)
				if (clip && effectId) {
					const result = buildDispatchResult(registry, {
						c: CMD.EFFECT_REMOVE,
						p: { id: clip.id, effectId },
					})
					registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				}
			} else if (choice === 7 && clips.length > 3) {
				const clip = pick(clips, random)
				if (clip) {
					const result = buildDispatchResult(registry, {
						c: CMD.TIMELINE_DELETE_CLIP,
						p: { id: clip.id },
					})
					registry = applyPatchEnvelopeToRegistry(registry, result.envelope)
				}
			}

			assertProjectInvariants(registry, projectId)
		}
	})
})
