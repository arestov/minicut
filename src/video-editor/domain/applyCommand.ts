import { nanoid } from 'nanoid'
import { createProjectGraph } from './createProject'
import { assertEntity, assertProject, validateCommand } from './validateCommand'
import {
	getClipIdsForTrack,
	getProjectEntity,
	getTrackEnd,
	getVideoTrack,
} from './selectors'
import {
	type AnimatedScalar,
	type ClipAttrs,
	type Command,
	type DispatchResult,
	type Entity,
	type EntityId,
	type ProjectRegistry,
	CMD,
	PATCH,
} from './types'

const makeEntityId = (prefix: string) => `${prefix}:${nanoid(6)}`

const scalar = (value: number): AnimatedScalar => ({ value })

const findClipTrack = (registry: ProjectRegistry, clipId: EntityId): Entity | null =>
	Object.values(registry.entitiesById).find(
		(entity) =>
			entity.type === 'track' &&
			Array.isArray(entity.rels.clips) &&
			entity.rels.clips.includes(clipId),
	) ?? null

export const buildDispatchResult = (
	registry: ProjectRegistry,
	command: Command,
): DispatchResult => {
	validateCommand(registry, command)

	switch (command.c) {
		case CMD.PROJECT_CREATE: {
			const { project, entities } = createProjectGraph(
				command.p.title || '',
				Object.keys(registry.projects).length + 1,
			)

			return {
				envelope: {
					projectId: project.id,
					version: 1,
					patches: [
						{ c: PATCH.PROJECT_SET, p: { project } },
						...entities.map((entity) => ({ c: PATCH.ENTITY_SET, p: { entity } }) as const),
						{
							c: PATCH.WORKSPACE_ACTIVE_PROJECT_SET,
							p: { projectId: project.id },
						},
					],
				},
				createdIds: { projectId: project.id },
			}
		}

		case CMD.RESOURCE_IMPORT: {
			const project = assertProject(registry, command.p.projectId)
			const projectEntity = getProjectEntity(registry, project)
			const resourceId = makeEntityId('resource')
			const resource: Entity = {
				id: resourceId,
				type: 'resource',
				attrs: {
					name: command.p.name,
					kind: command.p.kind,
					url: command.p.url ?? `sample://${resourceId}`,
					mime: command.p.mime ?? `${command.p.kind}/sample`,
					duration: command.p.duration,
					width: command.p.width,
					height: command.p.height,
					status: 'ready',
				},
				rels: {},
			}

			const resources = Array.isArray(projectEntity.rels.resources)
				? projectEntity.rels.resources
				: []

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{ c: PATCH.ENTITY_SET, p: { entity: resource } },
						{
							c: PATCH.REL_SPLICE,
							p: {
								id: project.rootEntityId,
								rel: 'resources',
								index: resources.length,
								deleteCount: 0,
								insert: [resourceId],
							},
						},
					],
				},
				createdIds: { resourceId },
			}
		}

		case CMD.TIMELINE_ADD_CLIP: {
			const project = assertProject(registry, command.p.projectId)
			const resource = assertEntity(registry, command.p.resourceId)
			const targetTrack = command.p.trackId
				? assertEntity(registry, command.p.trackId)
				: getVideoTrack(registry, project)

			if (!targetTrack) {
				throw new Error('No video track available for clip insertion')
			}

			const clipId = makeEntityId('clip')
			const clipStart = getTrackEnd(registry, targetTrack.id)
			const clipDuration = Number(resource.attrs.duration) || 1
			const clip: Entity = {
				id: clipId,
				type: 'clip',
				attrs: {
					name: String(resource.attrs.name),
					start: clipStart,
					duration: clipDuration,
					in: 0,
					opacity: scalar(1),
					transform: {
						x: scalar(0),
						y: scalar(0),
						scale: scalar(1),
						rotation: scalar(0),
					},
				},
				rels: {
					resource: resource.id,
					effects: [],
				},
			}

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{ c: PATCH.ENTITY_SET, p: { entity: clip } },
						{
							c: PATCH.REL_SPLICE,
							p: {
								id: targetTrack.id,
								rel: 'clips',
								index: getClipIdsForTrack(registry, targetTrack.id).length,
								deleteCount: 0,
								insert: [clipId],
							},
						},
					],
				},
				createdIds: { clipId },
			}
		}

		case CMD.TIMELINE_MOVE_CLIP: {
			const project = assertProject(registry, command.p.projectId)
			const clip = assertEntity(registry, command.p.clipId)
			const clipAttrs = clip.attrs as ClipAttrs

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{
							c: PATCH.ATTRS_MERGE,
							p: {
								id: clip.id,
								attrs: {
									start: Math.max(0, clipAttrs.start + command.p.delta),
								},
							},
						},
					],
				},
			}
		}

		case CMD.TIMELINE_SPLIT_CLIP: {
			const project = assertProject(registry, command.p.projectId)
			const clip = assertEntity(registry, command.p.clipId)
			const clipAttrs = clip.attrs as ClipAttrs
			const splitTime = command.p.time
			const clipEnd = clipAttrs.start + clipAttrs.duration

			if (splitTime <= clipAttrs.start || splitTime >= clipEnd) {
				throw new Error('Split time must be inside clip bounds')
			}

			const rightClipId = makeEntityId('clip')
			const rightClip: Entity = {
				id: rightClipId,
				type: 'clip',
				attrs: {
					...clipAttrs,
					start: splitTime,
					duration: clipEnd - splitTime,
				},
				rels: {
					...clip.rels,
				},
			}

			const track = findClipTrack(registry, clip.id)

			if (!track) {
				throw new Error(`Unable to find parent track for clip ${clip.id}`)
			}

			const clipIds = getClipIdsForTrack(registry, track.id)
			const clipIndex = clipIds.indexOf(clip.id)

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{
							c: PATCH.ATTRS_MERGE,
							p: {
								id: clip.id,
								attrs: {
									duration: splitTime - clipAttrs.start,
								},
							},
						},
						{ c: PATCH.ENTITY_SET, p: { entity: rightClip } },
						{
							c: PATCH.REL_SPLICE,
							p: {
								id: track.id,
								rel: 'clips',
								index: clipIndex + 1,
								deleteCount: 0,
								insert: [rightClipId],
							},
						},
					],
				},
				createdIds: { clipId: rightClipId },
			}
		}

		case CMD.TIMELINE_DELETE_CLIP: {
			const project = assertProject(registry, command.p.projectId)
			const clip = assertEntity(registry, command.p.clipId)
			const track = findClipTrack(registry, clip.id)
			if (!track) {
				throw new Error(`Unable to find parent track for clip ${clip.id}`)
			}

			const clipIds = getClipIdsForTrack(registry, track.id)
			const clipIndex = clipIds.indexOf(clip.id)
			const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{
							c: PATCH.REL_SPLICE,
							p: {
								id: track.id,
								rel: 'clips',
								index: clipIndex,
								deleteCount: 1,
								insert: [],
							},
						},
						...effectIds.map((id) => ({ c: PATCH.ENTITY_DELETE, p: { id } }) as const),
						{ c: PATCH.ENTITY_DELETE, p: { id: clip.id } },
					],
				},
				deletedIds: [clip.id, ...effectIds],
			}
		}

		case CMD.CLIP_UPDATE_ATTRS: {
			const project = assertProject(registry, command.p.projectId)
			assertEntity(registry, command.p.clipId)

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{
							c: PATCH.ATTRS_MERGE,
							p: {
								id: command.p.clipId,
								attrs: command.p.attrs,
							},
						},
					],
				},
			}
		}

		case CMD.EFFECT_ADD: {
			const project = assertProject(registry, command.p.projectId)
			const clip = assertEntity(registry, command.p.clipId)
			const effectId = makeEntityId('effect')
			const effects = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
			const effect: Entity = {
				id: effectId,
				type: 'effect',
				attrs: {
					name: command.p.name,
					kind: command.p.kind,
					amount: command.p.amount,
				},
				rels: {
					clip: clip.id,
				},
			}

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{ c: PATCH.ENTITY_SET, p: { entity: effect } },
						{
							c: PATCH.REL_SPLICE,
							p: {
								id: clip.id,
								rel: 'effects',
								index: effects.length,
								deleteCount: 0,
								insert: [effectId],
							},
						},
					],
				},
				createdIds: { effectId },
			}
		}

		default: {
			throw new Error(`Unsupported command code ${(command as { c: number }).c}`)
		}
	}
}
