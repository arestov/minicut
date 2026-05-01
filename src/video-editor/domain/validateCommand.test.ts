import { buildDispatchResult } from './applyCommand'
import { applyPatchEnvelopeInPlace } from './applyPatchInPlace'
import { applyPatchEnvelopeToRegistry } from './applyPatch'
import { createEmptyRegistry } from './createProject'
import { getAudioTrack, getClipIdsForTrack, getTracks, getVideoTrack } from './selectors'
import { CMD, PATCH, type Command } from './types'

describe('command validation', () => {
	it('rejects a clip insertion with a missing resource before producing patches', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, {
			c: CMD.PROJECT_CREATE,
			p: { title: 'Validation project' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)

		const invalidCommand: Command = {
			c: CMD.TIMELINE_ADD_CLIP,
			p: {
				projectId: String(createResult.createdIds?.projectId),
				resourceId: 'resource:missing',
			},
		}

		expect(() => buildDispatchResult(registry, invalidCommand)).toThrow('Unknown entity resource:missing')
		expect(registry.projects[String(createResult.createdIds?.projectId)].version).toBe(1)
	})

	it('rejects opacity updates outside the planned animated scalar bounds', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Clip source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		expect(() =>
			buildDispatchResult(registry, {
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: String(clipResult.createdIds?.clipId),
					attrs: { opacity: { value: 1.5 } },
				},
			}),
		).toThrow('Opacity must be between 0 and 1')
	})

	it('keeps immutable and in-place patch pipelines consistent for clip deletion', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		const deleteResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_DELETE_CLIP,
			p: { id: String(clipResult.createdIds?.clipId) },
		})

		const immutableNext = applyPatchEnvelopeToRegistry(registry, deleteResult.envelope)
		const inPlaceNext = structuredClone(registry)
		applyPatchEnvelopeInPlace(inPlaceNext, deleteResult.envelope)

		expect(inPlaceNext).toEqual(immutableNext)
		expect(immutableNext.entitiesById[String(clipResult.createdIds?.clipId)]).toBeUndefined()
		const project = immutableNext.projects[projectId]
		const track = getVideoTrack(immutableNext, project)
		expect(track).not.toBeNull()
		expect(getClipIdsForTrack(immutableNext, track!.id)).toEqual([])
	})

	it('routes audio resources into audio tracks when clip is inserted with audio trackId', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const project = registry.projects[projectId]
		const audioTrack = getAudioTrack(registry, project)
		expect(audioTrack).not.toBeNull()

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Voice over', kind: 'audio', duration: 3.5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: {
				projectId,
				resourceId: String(importResult.createdIds?.resourceId),
				trackId: String(audioTrack?.id),
			},
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		const clipId = String(clipResult.createdIds?.clipId)
		expect(getClipIdsForTrack(registry, String(audioTrack?.id))).toContain(clipId)
		const videoTrack = getVideoTrack(registry, project)
		expect(videoTrack).not.toBeNull()
		expect(getClipIdsForTrack(registry, String(videoTrack?.id))).not.toContain(clipId)
	})

	it('routes audio resources into audio tracks when no trackId is provided', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const project = registry.projects[projectId]
		const audioTrack = getAudioTrack(registry, project)
		expect(audioTrack).not.toBeNull()

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Default route voice', kind: 'audio', duration: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		expect(getClipIdsForTrack(registry, String(audioTrack?.id))).toContain(String(clipResult.createdIds?.clipId))
	})

	it('rejects video resources targeting audio tracks and locked tracks', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)
		const project = registry.projects[projectId]
		const audioTrack = getAudioTrack(registry, project)
		const videoTrack = getVideoTrack(registry, project)
		expect(audioTrack).not.toBeNull()
		expect(videoTrack).not.toBeNull()

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Video source', kind: 'video', duration: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		expect(() => buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId), trackId: String(audioTrack?.id) },
		})).toThrow('Expected video resource to target a video track')

		registry = applyPatchEnvelopeToRegistry(registry, {
			projectId,
			version: registry.projects[projectId].version + 1,
			patches: [{ c: PATCH.ATTRS_MERGE, p: { id: String(videoTrack?.id), attrs: { locked: true } } }],
		})

		expect(() => buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId), trackId: String(videoTrack?.id) },
		})).toThrow('Cannot add a clip to a locked track')
	})

	it('rejects split commands on clip boundaries', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Split source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		const clipId = String(clipResult.createdIds?.clipId)
		const clipAttrs = registry.entitiesById[clipId].attrs as { start: number, duration: number }

		for (const splitTime of [clipAttrs.start, clipAttrs.start + clipAttrs.duration]) {
			expect(() =>
				buildDispatchResult(registry, {
					c: CMD.TIMELINE_SPLIT_CLIP,
					p: { id: clipId, time: splitTime },
				}),
			).toThrow('Split time must be inside clip bounds')
		}
	})

	it('clamps moved clip start to zero when delta is too negative', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Move source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const clipId = String(clipResult.createdIds?.clipId)

		const moveForward = buildDispatchResult(registry, {
			c: CMD.TIMELINE_MOVE_CLIP,
			p: { id: clipId, delta: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, moveForward.envelope)

		const moveBackward = buildDispatchResult(registry, {
			c: CMD.TIMELINE_MOVE_CLIP,
			p: { id: clipId, delta: -100 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, moveBackward.envelope)

		expect(Number(registry.entitiesById[clipId].attrs.start)).toBe(0)
	})

	it('creates a new track and supports clip insertion into it', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const createTrackResult = buildDispatchResult(registry, {
			c: CMD.TRACK_CREATE,
			p: { projectId, kind: 'video', name: 'V2' },
		})
		registry = applyPatchEnvelopeToRegistry(registry, createTrackResult.envelope)

		const project = registry.projects[projectId]
		const newTrack = getTracks(registry, project).find((track) => String(track.attrs.name) === 'V2')
		expect(newTrack).not.toBeUndefined()

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Track source', kind: 'video', duration: 4 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: {
				projectId,
				resourceId: String(importResult.createdIds?.resourceId),
				trackId: String(newTrack?.id),
			},
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		expect(getClipIdsForTrack(registry, String(newTrack?.id))).toEqual([String(clipResult.createdIds?.clipId)])
	})

	it('keeps duplicate effects on the same clip in insertion order', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Effect source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const clipId = String(clipResult.createdIds?.clipId)

		const effectOne = buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Blur A', kind: 'blur', amount: 0.15 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, effectOne.envelope)

		const effectTwo = buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Blur B', kind: 'blur', amount: 0.45 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, effectTwo.envelope)

		const effects = registry.entitiesById[clipId].rels.effects
		expect(Array.isArray(effects)).toBe(true)
		expect(effects).toHaveLength(2)
		expect(String(effects[0])).not.toBe(String(effects[1]))
	})

	it('removes one effect without touching siblings and rejects detached effect ids', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Effect remove source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const clipId = String(clipResult.createdIds?.clipId)

		const effectOne = buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Blur A', kind: 'blur', amount: 0.15 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, effectOne.envelope)

		const effectTwo = buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Blur B', kind: 'blur', amount: 0.45 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, effectTwo.envelope)

		const firstEffectId = String(effectOne.createdIds?.effectId)
		const secondEffectId = String(effectTwo.createdIds?.effectId)
		const removeResult = buildDispatchResult(registry, {
			c: CMD.EFFECT_REMOVE,
			p: { id: clipId, effectId: firstEffectId },
		})
		registry = applyPatchEnvelopeToRegistry(registry, removeResult.envelope)

		expect(registry.entitiesById[firstEffectId]).toBeUndefined()
		expect(registry.entitiesById[clipId].rels.effects).toEqual([secondEffectId])

		expect(() =>
			buildDispatchResult(registry, {
				c: CMD.EFFECT_REMOVE,
				p: { id: clipId, effectId: firstEffectId },
			}),
		).toThrow('Unknown entity')
	})

	it('splits clips with cloned effect entities owned by the right clip', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Split effect source', kind: 'video', duration: 4 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)
		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const clipId = String(clipResult.createdIds?.clipId)
		const effectResult = buildDispatchResult(registry, {
			c: CMD.EFFECT_ADD,
			p: { id: clipId, name: 'Blur', kind: 'blur', amount: 0.25 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, effectResult.envelope)
		const originalEffectId = String(effectResult.createdIds?.effectId)

		const splitResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_SPLIT_CLIP,
			p: { id: clipId, time: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, splitResult.envelope)
		const rightClipId = String(splitResult.createdIds?.clipId)
		const rightEffects = registry.entitiesById[rightClipId].rels.effects
		expect(Array.isArray(rightEffects)).toBe(true)
		expect(rightEffects).toHaveLength(1)
		const clonedEffectId = String(rightEffects?.[0])

		expect(clonedEffectId).not.toBe(originalEffectId)
		expect(registry.entitiesById[clipId].rels.effects).toEqual([originalEffectId])
		expect(registry.entitiesById[clonedEffectId].rels.clip).toBe(rightClipId)
		expect(registry.entitiesById[originalEffectId].rels.clip).toBe(clipId)
	})

	it('uses scalar patches to preserve animated scalar siblings like keyframes', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Opacity source', kind: 'video', duration: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)
		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)
		const clipId = String(clipResult.createdIds?.clipId)
		registry.entitiesById[clipId].attrs.opacity = { value: 1, keyframes: ['kf:1'] }

		const updateResult = buildDispatchResult(registry, {
			c: CMD.CLIP_UPDATE_ATTRS,
			p: { id: clipId, attrs: { opacity: { value: 0.6 } } },
		})
		expect(updateResult.envelope.patches).toEqual([
			{ c: PATCH.SCALAR_SET, p: { id: clipId, path: 'opacity.value', value: 0.6 } },
		])
		registry = applyPatchEnvelopeToRegistry(registry, updateResult.envelope)

		expect(registry.entitiesById[clipId].attrs.opacity).toEqual({ value: 0.6, keyframes: ['kf:1'] })
	})

	it('rejects clip duration updates when duration is not positive', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const importResult = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Duration source', kind: 'video', duration: 5 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, importResult.envelope)

		const clipResult = buildDispatchResult(registry, {
			c: CMD.TIMELINE_ADD_CLIP,
			p: { projectId, resourceId: String(importResult.createdIds?.resourceId) },
		})
		registry = applyPatchEnvelopeToRegistry(registry, clipResult.envelope)

		expect(() =>
			buildDispatchResult(registry, {
				c: CMD.CLIP_UPDATE_ATTRS,
				p: {
					id: String(clipResult.createdIds?.clipId),
					attrs: { duration: 0 },
				},
			}),
		).toThrow('Clip duration must be positive')
	})

	it('supports duplicate resource names while creating distinct ids', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const firstImport = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Same name', kind: 'image', duration: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, firstImport.envelope)

		const secondImport = buildDispatchResult(registry, {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Same name', kind: 'image', duration: 2 },
		})
		registry = applyPatchEnvelopeToRegistry(registry, secondImport.envelope)

		expect(String(firstImport.createdIds?.resourceId)).not.toBe(String(secondImport.createdIds?.resourceId))
		const projectEntity = registry.entitiesById[registry.projects[projectId].rootEntityId]
		const resources = Array.isArray(projectEntity.rels.resources) ? projectEntity.rels.resources : []
		expect(resources).toHaveLength(2)
	})

	it('increments versions predictably when the same import command is dispatched twice', () => {
		let registry = createEmptyRegistry()
		const createResult = buildDispatchResult(registry, { c: CMD.PROJECT_CREATE, p: {} })
		registry = applyPatchEnvelopeToRegistry(registry, createResult.envelope)
		const projectId = String(createResult.createdIds?.projectId)

		const command: Command = {
			c: CMD.RESOURCE_IMPORT,
			p: { projectId, name: 'Repeat import', kind: 'video', duration: 1 },
		}

		const first = buildDispatchResult(registry, command)
		registry = applyPatchEnvelopeToRegistry(registry, first.envelope)
		const second = buildDispatchResult(registry, command)
		registry = applyPatchEnvelopeToRegistry(registry, second.envelope)

		expect(first.envelope.version).toBe(2)
		expect(second.envelope.version).toBe(3)
		const projectEntity = registry.entitiesById[registry.projects[projectId].rootEntityId]
		const resources = Array.isArray(projectEntity.rels.resources) ? projectEntity.rels.resources : []
		expect(resources).toHaveLength(2)
	})
})