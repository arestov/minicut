import { createProjectGraph } from './createProject'
import { assertEntity, assertProject, assertProjectForEntity, validateCommand } from './validateCommand'
import { createEntityId } from './id'
import {
	getClipIdsForTrack,
	getActiveTimeline,
	getAudioTrack,
	getProjectEntity,
	getTracks,
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
	type Patch,
	type ProjectRegistry,
	CMD,
	PATCH,
} from './types'

const scalar = (value: number): AnimatedScalar => ({ value })

const createClipEntity = ({
	resource,
	start,
	duration,
	mediaKind,
	name,
}: {
	resource: Entity
	start: number
	duration: number
	mediaKind?: 'video' | 'audio' | 'image'
	name?: string
}): Entity => ({
	id: createEntityId(),
	type: 'clip',
	attrs: {
		name: name ?? String(resource.attrs.name),
		mediaKind,
		start,
		duration,
		in: 0,
		fadeIn: 0,
		fadeOut: 0,
		audio: { gain: 1, pan: 0 },
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
})

export interface DispatchContext {
	clipTrackById?: Record<EntityId, EntityId>
}

const findClipTrack = (registry: ProjectRegistry, clipId: EntityId, context?: DispatchContext): Entity | null => {
	const indexedTrackId = context?.clipTrackById?.[clipId]
	if (indexedTrackId) {
		return registry.entitiesById[indexedTrackId] ?? null
	}

	return Object.values(registry.entitiesById).find(
		(entity) =>
			entity.type === 'track' &&
			Array.isArray(entity.rels.clips) &&
			entity.rels.clips.includes(clipId),
	) ?? null
}

export const buildDispatchResult = (
	registry: ProjectRegistry,
	command: Command,
	context?: DispatchContext,
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
			const resourceId = createEntityId()
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

		case CMD.TRACK_CREATE: {
			const project = assertProject(registry, command.p.projectId)
			const timeline = getActiveTimeline(registry, project)
			const trackCount = getTracks(registry, project).filter((track) => track.attrs.kind === command.p.kind).length
			const trackId = createEntityId()
			const tracks = Array.isArray(timeline.rels.tracks) ? timeline.rels.tracks : []
			const track: Entity = {
				id: trackId,
				type: 'track',
				attrs: {
					kind: command.p.kind,
					name: command.p.name ?? `${command.p.kind === 'video' ? 'V' : 'A'}${trackCount + 1}`,
					muted: false,
					locked: false,
					height: command.p.kind === 'video' ? 72 : 64,
				},
				rels: {
					clips: [],
				},
			}

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{ c: PATCH.ENTITY_SET, p: { entity: track } },
						{
							c: PATCH.REL_SPLICE,
							p: {
								id: timeline.id,
								rel: 'tracks',
								index: tracks.length,
								deleteCount: 0,
								insert: [trackId],
							},
						},
					],
				},
			}
		}

		case CMD.TIMELINE_ADD_CLIP: {
			const project = assertProject(registry, command.p.projectId)
			const resource = assertEntity(registry, command.p.resourceId)
			const resourceKind = resource.attrs.kind
			const targetTrack = command.p.trackId
				? assertEntity(registry, command.p.trackId)
				: resourceKind === 'audio'
					? getAudioTrack(registry, project)
					: getVideoTrack(registry, project)

			if (!targetTrack) {
				throw new Error(`No ${resourceKind === 'audio' ? 'audio' : 'video'} track available for clip insertion`)
			}

			const clipStart = getTrackEnd(registry, targetTrack.id)
			const clipDuration = Number(resource.attrs.duration) || 1
			const clip = createClipEntity({
				resource,
				start: clipStart,
				duration: clipDuration,
				mediaKind: resourceKind as 'video' | 'audio' | 'image',
			})
			const patches: Patch[] = [
				{ c: PATCH.ENTITY_SET, p: { entity: clip } },
				{
					c: PATCH.REL_SPLICE,
					p: {
						id: targetTrack.id,
						rel: 'clips',
						index: getClipIdsForTrack(registry, targetTrack.id).length,
						deleteCount: 0,
						insert: [clip.id],
					},
				},
			]
			let audioClipId: EntityId | undefined

			if (command.p.includeLinkedAudio && resourceKind === 'video') {
				const audioTrack = getAudioTrack(registry, project)
				if (!audioTrack) {
					throw new Error('No audio track available for linked video audio')
				}

				const audioClip = createClipEntity({
					resource,
					start: clipStart,
					duration: clipDuration,
					mediaKind: 'audio',
					name: 'Embedded audio',
				})
				audioClip.rels = { ...audioClip.rels, linkedVideoClip: clip.id }
				audioClipId = audioClip.id
				patches.push(
					{ c: PATCH.ENTITY_SET, p: { entity: audioClip } },
					{
						c: PATCH.REL_SPLICE,
						p: {
							id: audioTrack.id,
							rel: 'clips',
							index: getClipIdsForTrack(registry, audioTrack.id).length,
							deleteCount: 0,
							insert: [audioClip.id],
						},
					},
				)
			}

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches,
				},
				createdIds: { clipId: clip.id, audioClipId },
			}
		}

		case CMD.TIMELINE_MOVE_CLIP: {
			const project = assertProjectForEntity(registry, command.p.id)
			const clip = assertEntity(registry, command.p.id)
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
			const project = assertProjectForEntity(registry, command.p.id)
			const clip = assertEntity(registry, command.p.id)
			const clipAttrs = clip.attrs as ClipAttrs
			const splitTime = command.p.time
			const clipEnd = clipAttrs.start + clipAttrs.duration
			const leftDuration = splitTime - clipAttrs.start

			if (splitTime <= clipAttrs.start || splitTime >= clipEnd) {
				throw new Error('Split time must be inside clip bounds')
			}

			const rightClipId = createEntityId()
			const sourceEffectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
			const clonedEffects = sourceEffectIds.map((effectId) => {
				const effect = assertEntity(registry, effectId)
				const clonedEffectId = createEntityId()

				return {
					id: clonedEffectId,
					entity: {
						...effect,
						id: clonedEffectId,
						rels: {
							...effect.rels,
							clip: rightClipId,
						},
					},
				}
			})
			const rightClip: Entity = {
				id: rightClipId,
				type: 'clip',
				attrs: {
					...clipAttrs,
					start: splitTime,
					duration: clipEnd - splitTime,
					in: clipAttrs.in + leftDuration,
				},
				rels: {
					...clip.rels,
					effects: clonedEffects.map((effect) => effect.id),
				},
			}

			const track = findClipTrack(registry, clip.id, context)

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
									duration: leftDuration,
								},
							},
						},
						{ c: PATCH.ENTITY_SET, p: { entity: rightClip } },
						...clonedEffects.map((effect) => ({ c: PATCH.ENTITY_SET, p: { entity: effect.entity } }) as const),
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
			const project = assertProjectForEntity(registry, command.p.id)
			const clip = assertEntity(registry, command.p.id)
			const track = findClipTrack(registry, clip.id, context)
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
			const project = assertProjectForEntity(registry, command.p.id)
			const clip = assertEntity(registry, command.p.id)
			const { opacity, transform, ...attrs } = command.p.attrs
			const patches: Patch[] = []
			const clipAttrs = clip.attrs as ClipAttrs

			const transformMergeAttrs: Record<string, unknown> = {}
			if (transform) {
				for (const key of ['x', 'y', 'scale', 'rotation'] as const) {
					const incoming = transform[key]
					if (!incoming) {
						continue
					}

					if (incoming.value !== undefined) {
						patches.push({
							c: PATCH.SCALAR_SET,
							p: {
								id: command.p.id,
								path: `transform.${key}.value`,
								value: incoming.value,
							},
						})
					}

					const incomingRest = { ...incoming }
					delete incomingRest.value
					if (Object.keys(incomingRest).length > 0) {
						transformMergeAttrs[key] = {
							...(clipAttrs.transform[key] as Record<string, unknown>),
							...incomingRest,
						}
					}
				}
			}

			if (Object.keys(transformMergeAttrs).length > 0) {
				attrs.transform = {
					...clipAttrs.transform,
					...transformMergeAttrs,
				}
			}

			if (Object.keys(attrs).length > 0) {
				patches.push({
					c: PATCH.ATTRS_MERGE,
					p: {
						id: command.p.id,
						attrs,
					},
				})
			}

			if (opacity?.value !== undefined) {
				patches.push({
					c: PATCH.SCALAR_SET,
					p: {
						id: command.p.id,
						path: 'opacity.value',
						value: opacity.value,
					},
				})
			}

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches,
				},
			}
		}

		case CMD.EFFECT_ADD: {
			const project = assertProjectForEntity(registry, command.p.id)
			const clip = assertEntity(registry, command.p.id)
			const effectId = createEntityId()
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

		case CMD.EFFECT_REMOVE: {
			const project = assertProjectForEntity(registry, command.p.id)
			const clip = assertEntity(registry, command.p.id)
			assertEntity(registry, command.p.effectId)
			const effectIds = Array.isArray(clip.rels.effects) ? clip.rels.effects : []
			const effectIndex = effectIds.indexOf(command.p.effectId)

			if (effectIndex < 0) {
				throw new Error(`Effect ${command.p.effectId} is not attached to clip ${clip.id}`)
			}

			return {
				envelope: {
					projectId: project.id,
					version: project.version + 1,
					patches: [
						{
							c: PATCH.REL_SPLICE,
							p: {
								id: clip.id,
								rel: 'effects',
								index: effectIndex,
								deleteCount: 1,
								insert: [],
							},
						},
						{ c: PATCH.ENTITY_DELETE, p: { id: command.p.effectId } },
					],
				},
				deletedIds: [command.p.effectId],
			}
		}

		default: {
			throw new Error(`Unsupported command code ${(command as { c: number }).c}`)
		}
	}
}
