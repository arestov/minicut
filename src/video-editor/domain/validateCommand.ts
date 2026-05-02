import { getEntity, getProjectEntity, getProjectForEntity, getTrackForClip } from './selectors'
import { CMD, type ClipAttrs, type Command, type Entity, type ProjectGraph, type ProjectRegistry } from './types'

const assert = (condition: unknown, message: string): asserts condition => {
	if (!condition) {
		throw new Error(message)
	}
}

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0

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
			assert(command.p.name.trim().length > 0, 'Effect name is required')
			assert(['blur', 'sharpen', 'tint'].includes(command.p.kind), 'Effect kind is invalid')
			assert(command.p.amount >= 0 && command.p.amount <= 1, 'Effect amount must be between 0 and 1')
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