import { getEntity, getProjectEntity, getProjectForEntity, getTrackForClip } from './selectors'
import { CMD, type ClipAttrs, type Command, type EffectAttrs, type Entity, type OklchColor, type ProjectGraph, type ProjectRegistry, type ResourceDataState } from './types'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
	if (!condition) {
		throw new Error(message)
	}
}

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0

const isFiniteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0

const effectKinds = ['blur', 'sharpen', 'tint', 'color-correction', 'vignette', 'lut'] as const

const assertOklchColor = (color: OklchColor): void => {
	assert(Number.isFinite(color.l) && color.l >= 0 && color.l <= 1, 'OKLCH lightness must be between 0 and 1')
	assert(Number.isFinite(color.c) && color.c >= 0, 'OKLCH chroma must be non-negative')
	assert(Number.isFinite(color.h) && color.h >= 0 && color.h <= 360, 'OKLCH hue must be between 0 and 360')
	assert(Number.isFinite(color.alpha) && color.alpha >= 0 && color.alpha <= 1, 'OKLCH alpha must be between 0 and 1')
	assert(color.gamut === undefined || color.gamut === 'srgb' || color.gamut === 'p3', 'OKLCH gamut is invalid')
}

const assertEffectAttrs = (attrs: Partial<EffectAttrs>): void => {
	if (attrs.name !== undefined) {
		assert(attrs.name.trim().length > 0, 'Effect name is required')
	}
	if (attrs.kind !== undefined) {
		assert(effectKinds.includes(attrs.kind), 'Effect kind is invalid')
	}
	if (attrs.enabled !== undefined) {
		assert(typeof attrs.enabled === 'boolean', 'Effect enabled flag must be boolean')
	}
	if (attrs.amount !== undefined) {
		assert(attrs.amount >= 0 && attrs.amount <= 1, 'Effect amount must be between 0 and 1')
	}
	if (attrs.color !== undefined) {
		assertOklchColor(attrs.color)
	}
}

const assertSerializableResourceData = (data: ResourceDataState): void => {
	assert(['missing', 'partial', 'ready'].includes(data.status), 'Resource data status is invalid')
	assert(isFinitePositive(data.chunkSize), 'Resource chunk size must be positive')
	assert(isFiniteNonNegative(data.loadedBytes), 'Resource loaded bytes must be non-negative')
	assert(data.chunks && typeof data.chunks === 'object', 'Resource chunks must be an object')
	assert(data.ranges && typeof data.ranges === 'object', 'Resource ranges must be an object')
	assert(Array.isArray(data.ranges.loaded), 'Resource loaded ranges must be an array')
	assert(Array.isArray(data.ranges.requested), 'Resource requested ranges must be an array')

	for (const range of [...data.ranges.loaded, ...data.ranges.requested]) {
		assert(Array.isArray(range) && range.length === 2, 'Resource ranges must be byte pairs')
		assert(isFiniteNonNegative(range[0]) && isFiniteNonNegative(range[1]) && range[1] >= range[0], 'Resource range bounds are invalid')
	}

	for (const chunk of Object.values(data.chunks)) {
		assert(Number.isInteger(chunk.index) && chunk.index >= 0, 'Resource chunk index is invalid')
		assert(isFiniteNonNegative(chunk.start), 'Resource chunk start is invalid')
		assert(isFiniteNonNegative(chunk.end) && chunk.end >= chunk.start, 'Resource chunk end is invalid')
		assert(isFiniteNonNegative(chunk.size), 'Resource chunk size is invalid')
		assert(['missing', 'loading', 'ready'].includes(chunk.status), 'Resource chunk status is invalid')
	}
}

export const assertProject = (registry: ProjectRegistry, projectId: string): ProjectGraph => {
	const project = registry.projects[projectId]
	assert(project, `Unknown project ${projectId}`)
	return project
}

export const assertProjectForEntity = (
	registry: ProjectRegistry,
	entityId: string,
): ProjectGraph => {
	const project = getProjectForEntity(registry, entityId)
	assert(project, `Unable to resolve project for entity ${entityId}`)
	return project
}

export const assertEntity = (registry: ProjectRegistry, entityId: string): Entity => {
	const entity = getEntity(registry, entityId)
	assert(entity, `Unknown entity ${entityId}`)
	return entity
}

export const assertEntityType = (
	registry: ProjectRegistry,
	entityId: string,
	type: Entity['type'],
): Entity => {
	const entity = assertEntity(registry, entityId)
	assert(entity.type === type, `Expected ${entityId} to be ${type}, got ${entity.type}`)
	return entity
}

const assertProjectGraphShape = (registry: ProjectRegistry, project: ProjectGraph): void => {
	const root = getProjectEntity(registry, project)
	assert(root.type === 'project', 'Project root entity must have type project')
	assert(Array.isArray(root.rels.resources), 'project.rels.resources must be an array')
	assert(Array.isArray(root.rels.timelines), 'project.rels.timelines must be an array')
	assert(typeof root.rels.activeTimeline === 'string', 'project.rels.activeTimeline must be an id')
	assertEntityType(registry, String(root.rels.activeTimeline), 'timeline')
}

const assertClipTarget = (
	registry: ProjectRegistry,
	target: { id: string },
): Entity => {
	return assertEntityType(registry, target.id, 'clip')
}

const assertClipTrackUnlocked = (registry: ProjectRegistry, clipId: string): void => {
	const track = getTrackForClip(registry, clipId)
	assert(track, `Unable to resolve track for clip ${clipId}`)
	assert(track.attrs.locked !== true, 'Cannot modify a clip on a locked track')
}

export const validateCommand = (registry: ProjectRegistry, command: Command): void => {
	switch (command.c) {
		case CMD.PROJECT_CREATE:
			assert(!command.p.title || typeof command.p.title === 'string', 'Project title must be a string')
			return

		case CMD.RESOURCE_IMPORT: {
			const project = assertProject(registry, command.p.projectId)
			assertProjectGraphShape(registry, project)
			assert(command.p.name.trim().length > 0, 'Resource name is required')
			assert(['video', 'audio', 'image'].includes(command.p.kind), 'Resource kind is invalid')
			assert(isFinitePositive(command.p.duration), 'Resource duration must be positive')
			assert(!command.p.url || typeof command.p.url === 'string', 'Resource url must be a string')
			assert(!command.p.mime || typeof command.p.mime === 'string', 'Resource mime must be a string')
			if (command.p.size !== undefined) {
				assert(isFiniteNonNegative(command.p.size), 'Resource size must be non-negative')
			}
			if (command.p.chunkSize !== undefined) {
				assert(isFinitePositive(command.p.chunkSize), 'Resource chunk size must be positive')
			}
			if (command.p.dataStatus !== undefined) {
				assert(['missing', 'partial', 'ready'].includes(command.p.dataStatus), 'Resource data status is invalid')
			}
			if (command.p.source !== undefined) {
				assert(['local', 'p2p'].includes(command.p.source.kind), 'Resource source kind is invalid')
				assert(!command.p.source.ownerPeerId || typeof command.p.source.ownerPeerId === 'string', 'Resource owner peer id must be a string')
			}
			if (command.p.data !== undefined) {
				assertSerializableResourceData(command.p.data)
			}
			return
		}

		case CMD.TRACK_CREATE: {
			const project = assertProject(registry, command.p.projectId)
			assertProjectGraphShape(registry, project)
			assert(['video', 'audio'].includes(command.p.kind), 'Track kind is invalid')
			assert(!command.p.name || command.p.name.trim().length > 0, 'Track name must not be empty')
			return
		}

		case CMD.TIMELINE_ADD_CLIP: {
			const project = assertProject(registry, command.p.projectId)
			assertProjectGraphShape(registry, project)
			const resource = assertEntityType(registry, command.p.resourceId, 'resource')
			assert(command.p.includeLinkedAudio === undefined || typeof command.p.includeLinkedAudio === 'boolean', 'Linked audio flag must be boolean')
			if (command.p.trackId) {
				const track = assertEntityType(registry, command.p.trackId, 'track')
				const resourceKind = resource.attrs.kind
				const expectedTrackKind = resourceKind === 'audio' ? 'audio' : 'video'
				assert(track.attrs.kind === expectedTrackKind, `Expected ${resourceKind} resource to target a ${expectedTrackKind} track`)
				assert(track.attrs.locked !== true, 'Cannot add a clip to a locked track')
			}
			return
		}

		case CMD.TIMELINE_MOVE_CLIP: {
			assertClipTarget(registry, command.p)
			assertProjectForEntity(registry, command.p.id)
			assertClipTrackUnlocked(registry, command.p.id)
			assert(Number.isFinite(command.p.delta), 'Move delta must be finite')
			return
		}

		case CMD.TIMELINE_SPLIT_CLIP: {
			const clip = assertClipTarget(registry, command.p)
			assertProjectForEntity(registry, command.p.id)
			assertClipTrackUnlocked(registry, command.p.id)
			const attrs = clip.attrs as unknown as ClipAttrs
			assert(Number.isFinite(command.p.time), 'Split time must be finite')
			assert(
				command.p.time > attrs.start && command.p.time < attrs.start + attrs.duration,
				'Split time must be inside clip bounds',
			)
			return
		}

		case CMD.TIMELINE_DELETE_CLIP: {
			assertClipTarget(registry, command.p)
			assertProjectForEntity(registry, command.p.id)
			assertClipTrackUnlocked(registry, command.p.id)
			return
		}

		case CMD.CLIP_UPDATE_ATTRS: {
			assertClipTarget(registry, command.p)
			assertProjectForEntity(registry, command.p.id)
			assertClipTrackUnlocked(registry, command.p.id)
			if (command.p.attrs.opacity) {
				const opacity = command.p.attrs.opacity.value
				assert(opacity >= 0 && opacity <= 1, 'Opacity must be between 0 and 1')
			}
			if (command.p.attrs.duration !== undefined) {
				assert(isFinitePositive(command.p.attrs.duration), 'Clip duration must be positive')
			}
			if (command.p.attrs.start !== undefined) {
				assert(Number.isFinite(command.p.attrs.start) && command.p.attrs.start >= 0, 'Clip start must be non-negative')
			}
			if (command.p.attrs.in !== undefined) {
				assert(Number.isFinite(command.p.attrs.in) && command.p.attrs.in >= 0, 'Clip in point must be non-negative')
			}
			if (command.p.attrs.fadeIn !== undefined) {
				assert(Number.isFinite(command.p.attrs.fadeIn) && command.p.attrs.fadeIn >= 0, 'Clip fade in must be non-negative')
			}
			if (command.p.attrs.fadeOut !== undefined) {
				assert(Number.isFinite(command.p.attrs.fadeOut) && command.p.attrs.fadeOut >= 0, 'Clip fade out must be non-negative')
			}
			if (command.p.attrs.audio !== undefined) {
				assert(Number.isFinite(command.p.attrs.audio.gain) && command.p.attrs.audio.gain >= 0 && command.p.attrs.audio.gain <= 1.5, 'Audio gain must be between 0 and 1.5')
				assert(Number.isFinite(command.p.attrs.audio.pan) && command.p.attrs.audio.pan >= -1 && command.p.attrs.audio.pan <= 1, 'Audio pan must be between -1 and 1')
			}
			const transform = command.p.attrs.transform
			if (transform) {
				if (transform.scale?.value !== undefined) {
					assert(transform.scale.value > 0, 'Transform scale must be positive')
				}
			}
			return
		}

		case CMD.EFFECT_ADD: {
			assertClipTarget(registry, command.p)
			assertProjectForEntity(registry, command.p.id)
			assertClipTrackUnlocked(registry, command.p.id)
			assertEffectAttrs(command.p)
			assert(effectKinds.includes(command.p.kind), 'Effect kind is invalid')
			return
		}

		case CMD.EFFECT_UPDATE_ATTRS: {
			const effect = assertEntityType(registry, command.p.id, 'effect')
			assertProjectForEntity(registry, String(effect.rels.clip))
			assertEffectAttrs(command.p.attrs)
			return
		}

		case CMD.EFFECT_REORDER: {
			const clip = assertClipTarget(registry, command.p)
			assertProjectForEntity(registry, command.p.id)
			assertClipTrackUnlocked(registry, command.p.id)
			const effect = assertEntityType(registry, command.p.effectId, 'effect')
			const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
			assert(effectIds.includes(command.p.effectId), 'Effect must belong to the target clip')
			assert(String(effect.rels.clip) === clip.id, 'Effect clip relation must match target clip')
			assert(Number.isInteger(command.p.toIndex) && command.p.toIndex >= 0, 'Effect reorder index must be a non-negative integer')
			return
		}

		case CMD.EFFECT_REMOVE: {
			const clip = assertClipTarget(registry, command.p)
			assertProjectForEntity(registry, command.p.id)
			assertClipTrackUnlocked(registry, command.p.id)
			const effect = assertEntityType(registry, command.p.effectId, 'effect')
			const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
			assert(effectIds.includes(command.p.effectId), 'Effect must belong to the target clip')
			assert(String(effect.rels.clip) === clip.id, 'Effect clip relation must match target clip')
			return
		}

		default:
			throw new Error(`Unsupported command code ${(command as { c: number }).c}`)
	}
}