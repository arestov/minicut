import { createEntityId } from './id'
import { createDefaultColorCorrectionAttrs, createDefaultTextAttrs } from './applyCommandDefaults'
import { createMissingResourceData, createReadyResourceData } from './resourceData'
import { getAudioTrack, getClipIdsForTrack, getActiveTimeline, getTracks, getTrackEnd, getVideoTrack } from './selectors'
import type { AnimatedScalar, ClipAttrs, DispatchResult, Entity, EntityId, Patch, ProjectRegistry, TextAttrs } from './types'
import { PATCH } from './types'

export interface DispatchContext {
	clipTrackById?: Record<EntityId, EntityId>
}

export type CommandHandler<CommandType> = (
	registry: ProjectRegistry,
	command: CommandType,
	context?: DispatchContext,
) => DispatchResult

export const scalar = (value: number): AnimatedScalar => ({ value })

export const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs

export const mergeTextAttrs = (current: TextAttrs, attrs: Partial<TextAttrs>): Partial<TextAttrs> => ({
	...attrs,
	...(attrs.style ? { style: { ...current.style, ...attrs.style } } : {}),
	...(attrs.box ? { box: { ...current.box, ...attrs.box } } : {}),
})

export const createClipEntity = ({
	resource,
	start,
	duration,
	mediaKind,
	name,
}: {
	resource: Entity
	start: number
	duration: number
	mediaKind?: ClipAttrs['mediaKind']
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

export const createTextClipEntity = ({
	text,
	start,
	duration,
}: {
	text: Entity
	start: number
	duration: number
}): Entity => ({
	id: createEntityId(),
	type: 'clip',
	attrs: {
		name: 'Text',
		mediaKind: 'text',
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
		text: text.id,
		effects: [],
	},
})

export const findClipTrack = (registry: ProjectRegistry, clipId: EntityId, context?: DispatchContext): Entity | null => {
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

export const createResourceImportPatches = (registry: ProjectRegistry, projectEntity: Entity, command: {
	p: {
		name: string
		kind: ClipAttrs['mediaKind'] | 'audio' | 'image'
		duration: number
		url?: string
		mime?: string
		width?: number
		height?: number
		size?: number
		source?: Entity['attrs']['source']
		data?: Entity['attrs']['data']
		dataStatus?: Entity['attrs']['status']
		chunkSize?: number
	}
}): { resource: Entity; patches: Patch[] } => {
	const resourceId = createEntityId()
	const dataStatus = command.p.dataStatus ?? command.p.data?.status ?? 'ready'
	const data = command.p.data ?? (dataStatus === 'ready'
		? createReadyResourceData({ size: command.p.size, chunkSize: command.p.chunkSize })
		: createMissingResourceData(command.p.chunkSize))
	const source = command.p.source ?? { kind: 'local' as const }
	const resource: Entity = {
		id: resourceId,
		type: 'resource',
		attrs: {
			name: command.p.name,
			kind: command.p.kind,
			url: command.p.url ?? (data.status === 'missing' ? '' : `sample://${resourceId}`),
			mime: command.p.mime ?? `${command.p.kind}/sample`,
			duration: command.p.duration,
			width: command.p.width,
			height: command.p.height,
			size: command.p.size,
			source,
			data,
			status: data.status,
		},
		rels: {},
	}
	const resources = Array.isArray(projectEntity.rels.resources)
		? projectEntity.rels.resources
		: []

	return {
		resource,
		patches: [
			{ c: PATCH.ENTITY_SET, p: { entity: resource } },
			{ c: PATCH.REL_SPLICE, p: { id: projectEntity.id, rel: 'resources', index: resources.length, deleteCount: 0, insert: [resourceId] } },
		],
	}
}

export { createDefaultColorCorrectionAttrs, createDefaultTextAttrs, getAudioTrack, getClipIdsForTrack, getActiveTimeline, getTracks, getTrackEnd, getVideoTrack }
