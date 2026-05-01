import { nanoid } from 'nanoid'
import { createProjectGraph } from './createProject'
import {
	getClipIdsForTrack,
	getEntity,
	getProjectEntity,
	getTrackEnd,
	getVideoTrack,
} from './selectors'
import {
	type ClipAttrs,
	type Command,
	type DispatchResult,
	type Entity,
	type EntityId,
	type ProjectGraph,
	type ProjectRegistry,
	CMD,
	PATCH,
} from './types'

const makeEntityId = (prefix: string) => `${prefix}:${nanoid(6)}`

const assertProject = (registry: ProjectRegistry, projectId: string): ProjectGraph => {
	const project = registry.projects[projectId]
	if (!project) {
		throw new Error(`Unknown project ${projectId}`)
	}

	return project
}

const assertEntity = (project: ProjectGraph, entityId: EntityId): Entity => {
	const entity = getEntity(project, entityId)
	if (!entity) {
		throw new Error(`Unknown entity ${entityId}`)
	}

	return entity
}

export const buildDispatchResult = (
	registry: ProjectRegistry,
	command: Command,
): DispatchResult => {
	switch (command.c) {
		case CMD.PROJECT_CREATE: {
			const project = createProjectGraph(
				command.p.title || '',
				Object.keys(registry.projects).length + 1,
			)

			return {
				envelope: {
					projectId: project.id,
					version: 1,
					patches: [
						{ c: PATCH.PROJECT_SET, p: { project } },
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
			const projectEntity = getProjectEntity(project)
			const resourceId = makeEntityId('resource')
			const resource: Entity = {
				id: resourceId,
				type: 'resource',
				attrs: {
					name: command.p.name,
					kind: command.p.kind,
					duration: command.p.duration,
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
			const resource = assertEntity(project, command.p.resourceId)
			const targetTrack = command.p.trackId
				? assertEntity(project, command.p.trackId)
				: getVideoTrack(project)

			if (!targetTrack) {
				throw new Error('No video track available for clip insertion')
			}

			const clipId = makeEntityId('clip')
			const clipStart = getTrackEnd(project, targetTrack.id)
			const clipDuration = Number(resource.attrs.duration) || 1
			const clip: Entity = {
				id: clipId,
				type: 'clip',
				attrs: {
					name: String(resource.attrs.name),
					start: clipStart,
					duration: clipDuration,
					opacity: 1,
				},
				rels: {
					resource: resource.id,
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
								index: getClipIdsForTrack(project, targetTrack.id).length,
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
			const clip = assertEntity(project, command.p.clipId)
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
			const clip = assertEntity(project, command.p.clipId)
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

			const track = Object.values(project.entities).find(
				(entity) =>
					entity.type === 'track' &&
					Array.isArray(entity.rels.clips) &&
					entity.rels.clips.includes(clip.id),
			)

			if (!track) {
				throw new Error(`Unable to find parent track for clip ${clip.id}`)
			}

			const clipIds = getClipIdsForTrack(project, track.id)
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

		case CMD.CLIP_UPDATE_ATTRS: {
			const project = assertProject(registry, command.p.projectId)
			assertEntity(project, command.p.clipId)

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

		default: {
			throw new Error(`Unsupported command code ${(command as { c: number }).c}`)
		}
	}
}
