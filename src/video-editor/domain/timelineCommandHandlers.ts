import { createEntityId } from './id'
import {
	asClipAttrs,
	createClipEntity,
	createTextClipEntity,
	findClipTrack,
	getAudioTrack,
	getClipIdsForTrack,
	getTrackEnd,
	getVideoTrack,
	type CommandHandler,
} from './applyCommandHelpers'
import { createDefaultTextAttrs } from './applyCommandDefaults'
import { assertEntity, assertProject, assertProjectForEntity } from './validateCommand'
import { CMD, PATCH, type ClipAttrs, type Command, type Entity, type Patch, type TextAttrs } from './types'

type CommandByCode<Code extends Command['c']> = Extract<Command, { c: Code }>

export const handleTimelineAddClip: CommandHandler<CommandByCode<typeof CMD.TIMELINE_ADD_CLIP>> = (registry, command) => {
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
		mediaKind: resourceKind as ClipAttrs['mediaKind'],
	})
	const patches: Patch[] = [
		{ c: PATCH.ENTITY_SET, p: { entity: clip } },
		{ c: PATCH.REL_SPLICE, p: { id: targetTrack.id, rel: 'clips', index: getClipIdsForTrack(registry, targetTrack.id).length, deleteCount: 0, insert: [clip.id] } },
	]
	let audioClipId: string | undefined

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
			{ c: PATCH.REL_SPLICE, p: { id: audioTrack.id, rel: 'clips', index: getClipIdsForTrack(registry, audioTrack.id).length, deleteCount: 0, insert: [audioClip.id] } },
		)
	}

	return {
		envelope: { projectId: project.id, version: project.version + 1, patches },
		createdIds: { clipId: clip.id, audioClipId },
	}
}

export const handleTextAdd: CommandHandler<CommandByCode<typeof CMD.TEXT_ADD>> = (registry, command) => {
	const project = assertProject(registry, command.p.projectId)
	const targetTrack = command.p.trackId ? assertEntity(registry, command.p.trackId) : getVideoTrack(registry, project)

	if (!targetTrack) {
		throw new Error('No video track available for text insertion')
	}

	const text: Entity = {
		id: createEntityId(),
		type: 'text',
		attrs: {
			...createDefaultTextAttrs(command.p.content),
			...command.p.attrs,
			content: command.p.attrs?.content ?? command.p.content ?? 'Text',
		},
		rels: {},
	}
	const clip = createTextClipEntity({
		text,
		start: command.p.start ?? getTrackEnd(registry, targetTrack.id),
		duration: command.p.duration ?? 5,
	})

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [
				{ c: PATCH.ENTITY_SET, p: { entity: text } },
				{ c: PATCH.ENTITY_SET, p: { entity: clip } },
				{ c: PATCH.REL_SPLICE, p: { id: targetTrack.id, rel: 'clips', index: getClipIdsForTrack(registry, targetTrack.id).length, deleteCount: 0, insert: [clip.id] } },
			],
		},
		createdIds: { clipId: clip.id, textId: text.id },
	}
}

export const handleTimelineMoveClip: CommandHandler<CommandByCode<typeof CMD.TIMELINE_MOVE_CLIP>> = (registry, command) => {
	const project = assertProjectForEntity(registry, command.p.id)
	const clip = assertEntity(registry, command.p.id)
	const clipAttrs = asClipAttrs(clip.attrs)

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [{ c: PATCH.ATTRS_MERGE, p: { id: clip.id, attrs: { start: Math.max(0, clipAttrs.start + command.p.delta) } } }],
		},
	}
}

export const handleTimelineSplitClip: CommandHandler<CommandByCode<typeof CMD.TIMELINE_SPLIT_CLIP>> = (registry, command, context) => {
	const project = assertProjectForEntity(registry, command.p.id)
	const clip = assertEntity(registry, command.p.id)
	const clipAttrs = asClipAttrs(clip.attrs)
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
			entity: { ...effect, id: clonedEffectId, rels: { ...effect.rels, clip: rightClipId } },
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
		rels: { ...clip.rels, effects: clonedEffects.map((effect) => effect.id) },
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
				{ c: PATCH.ATTRS_MERGE, p: { id: clip.id, attrs: { duration: leftDuration } } },
				{ c: PATCH.ENTITY_SET, p: { entity: rightClip } },
				...clonedEffects.map((effect) => ({ c: PATCH.ENTITY_SET, p: { entity: effect.entity } }) as const),
				{ c: PATCH.REL_SPLICE, p: { id: track.id, rel: 'clips', index: clipIndex + 1, deleteCount: 0, insert: [rightClipId] } },
			],
		},
		createdIds: { clipId: rightClipId },
	}
}

export const handleTimelineDeleteClip: CommandHandler<CommandByCode<typeof CMD.TIMELINE_DELETE_CLIP>> = (registry, command, context) => {
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
				{ c: PATCH.REL_SPLICE, p: { id: track.id, rel: 'clips', index: clipIndex, deleteCount: 1, insert: [] } },
				...effectIds.map((id) => ({ c: PATCH.ENTITY_DELETE, p: { id } }) as const),
				{ c: PATCH.ENTITY_DELETE, p: { id: clip.id } },
			],
		},
		deletedIds: [clip.id, ...effectIds],
	}
}
