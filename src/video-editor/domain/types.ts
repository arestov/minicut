export type ProjectId = string
export type EntityId = string
export type RelValue = EntityId | EntityId[] | null

export type EntityType = 'project' | 'timeline' | 'track' | 'resource' | 'clip' | 'effect' | 'keyframe'

export interface Entity {
	id: EntityId
	type: EntityType
	attrs: Record<string, unknown>
	rels: Record<string, RelValue>
}

export interface GraphRoot {
	entitiesById: Record<EntityId, Entity>
}

export interface ProjectGraph {
	id: ProjectId
	version: number
	rootEntityId: EntityId
}

export interface ProjectRegistry extends GraphRoot {
	activeProjectId: ProjectId | null
	projects: Record<ProjectId, ProjectGraph>
}

export interface ProjectMeta {
	id: ProjectId
	title: string
	version: number
	resourceCount: number
	clipCount: number
}

export interface EditorSessionState {
	tabId: string
	activeProjectId: ProjectId | null
	selectedEntityId: EntityId | null
	cursor: number
	isPlaying: boolean
	timelineZoom: number
}


export type ResourceKind = 'video' | 'audio' | 'image'
export type ResourceSourceKind = 'local' | 'p2p'
export type ResourceDataStatus = 'missing' | 'partial' | 'ready'
export type ResourceChunkStatus = 'missing' | 'loading' | 'ready'
export type ResourceByteRange = [number, number]

export interface ResourceSource {
	kind: ResourceSourceKind
	ownerPeerId?: string
}

export interface ResourceChunkMeta {
	index: number
	start: number
	end: number
	size: number
	status: ResourceChunkStatus
}

export interface ResourceDataState {
	status: ResourceDataStatus
	chunkSize: number
	chunks: Record<number, ResourceChunkMeta>
	ranges: {
		loaded: ResourceByteRange[]
		requested: ResourceByteRange[]
	}
	loadedBytes: number
}

export interface ResourceDerived {
	progress: number
	isPlayable: boolean
	loadedBytes: number
	loadedRanges: ResourceByteRange[]
	requestedRanges: ResourceByteRange[]
}

export interface Peer {
	id: string
	resources: EntityId[]
}

export interface ResourceAttrs {
	name: string
	kind: ResourceKind
	url: string
	mime: string
	duration: number
	width?: number
	height?: number
	size?: number
	source: ResourceSource
	data: ResourceDataState
	status: ResourceDataStatus | 'loading' | 'error'
}

export interface TrackAttrs {
	kind: 'video' | 'audio'
	name: string
	muted: boolean
	locked: boolean
	height: number
}

export interface ProjectAttrs {
	title: string
	fps: number
	width: number
	height: number
	duration: number
	createdAt: number
	updatedAt: number
}

export interface TimelineAttrs {
	name: string
	duration: number
}

export interface AnimatedScalar {
	value: number
	keyframes?: EntityId[]
}

export interface OklchColor {
	l: number
	c: number
	h: number
	alpha: number
	gamut?: 'srgb' | 'p3'
}

export interface ColorCorrectionAttrs {
	exposure: AnimatedScalar
	contrast: AnimatedScalar
	highlights: AnimatedScalar
	shadows: AnimatedScalar
	saturation: AnimatedScalar
	vibrance: AnimatedScalar
	temperature: AnimatedScalar
	tint: AnimatedScalar
	hue: AnimatedScalar
	gamma: AnimatedScalar
}

export type EffectKind = 'blur' | 'sharpen' | 'tint' | 'color-correction' | 'vignette' | 'lut'

export interface EffectAttrs {
	name: string
	kind: EffectKind
	enabled: boolean
	amount?: number
	params?: Partial<ColorCorrectionAttrs> | Record<string, unknown>
	color?: OklchColor
}

export interface KeyframeAttrs {
	time: number
	value: number
	interpolation?: 'linear' | 'hold'
}

export interface CommandTargetRef {
	id: EntityId
}

export interface TransformAttrs {
	x: AnimatedScalar
	y: AnimatedScalar
	scale: AnimatedScalar
	rotation: AnimatedScalar
}

export interface ClipAttrs {
	name: string
	color?: string
	mediaKind?: ResourceAttrs['kind']
	start: number
	duration: number
	in: number
	fadeIn?: number
	fadeOut?: number
	audio?: {
		gain: number
		pan: number
	}
	opacity: AnimatedScalar
	transform: TransformAttrs
}

export interface PatchEnvelope {
	projectId: ProjectId
	version: number
	patches: Patch[]
}

export const MSG = {
	SNAPSHOT_REQUEST: -1,
	SNAPSHOT: -2,
	COMMAND: -3,
	PATCHES: -4,
	ERROR: -5,
	DISPATCH_RESULT: -6,
	DISCONNECT: -7,
	UNDO: -8,
	REDO: -9,
	HISTORY_STATE_REQUEST: -10,
	HISTORY_STATE: -11,
	REGISTRY_RESTORE_REQUEST: -12,
	REGISTRY_RESTORE_ACK: -13,
} as const

export const AUTHORITY_PROTOCOL_VERSION = 1 as const
export const RESOURCE_TRANSFER_PROTOCOL_VERSION = 1 as const

export interface WireProtocolMeta {
	protocolVersion?: number
	schemaVersion?: number
	capabilities?: string[]
}

export const CMD = {
	PROJECT_CREATE: -100,
	RESOURCE_IMPORT: -110,
	TRACK_CREATE: -115,
	TIMELINE_ADD_CLIP: -120,
	TIMELINE_MOVE_CLIP: -121,
	TIMELINE_SPLIT_CLIP: -122,
	TIMELINE_DELETE_CLIP: -123,
	CLIP_UPDATE_ATTRS: -130,
	EFFECT_ADD: -140,
	EFFECT_REMOVE: -141,
	EFFECT_UPDATE_ATTRS: -142,
	EFFECT_REORDER: -143,
} as const

export const PATCH = {
	REGISTRY_SET: -199,
	PROJECT_SET: -200,
	ENTITY_SET: -210,
	ENTITY_DELETE: -211,
	ATTRS_MERGE: -220,
	SCALAR_SET: -225,
	REL_SPLICE: -231,
	WORKSPACE_ACTIVE_PROJECT_SET: -240,
} as const

export type Command =
	| {
			c: typeof CMD.PROJECT_CREATE
			p: { title?: string }
	  }
	| {
			c: typeof CMD.RESOURCE_IMPORT
			p: {
				projectId: ProjectId
				name: string
				kind: ResourceAttrs['kind']
				duration: number
				url?: string
				mime?: string
				width?: number
				height?: number
				size?: number
				source?: ResourceSource
				data?: ResourceDataState
				dataStatus?: ResourceDataStatus
				chunkSize?: number
			}
	  }
	| {
			c: typeof CMD.TRACK_CREATE
			p: {
				projectId: ProjectId
				kind: TrackAttrs['kind']
				name?: string
			}
	  }
	| {
			c: typeof CMD.TIMELINE_ADD_CLIP
			p: {
				projectId: ProjectId
				resourceId: EntityId
				trackId?: EntityId
				includeLinkedAudio?: boolean
			}
	  }
	| {
			c: typeof CMD.TIMELINE_MOVE_CLIP
			p: CommandTargetRef & {
				delta: number
			}
	  }
	| {
			c: typeof CMD.TIMELINE_SPLIT_CLIP
			p: CommandTargetRef & {
				time: number
			}
	  }
	| {
			c: typeof CMD.TIMELINE_DELETE_CLIP
			p: CommandTargetRef
	  }
	| {
			c: typeof CMD.CLIP_UPDATE_ATTRS
			p: CommandTargetRef & {
				attrs: Partial<ClipAttrs>
			}
	  }
	| {
			c: typeof CMD.EFFECT_ADD
			p: CommandTargetRef & {
				name: string
				kind: EffectKind
				amount?: number
				params?: Record<string, unknown>
				color?: OklchColor
			}
	  }
	| {
			c: typeof CMD.EFFECT_UPDATE_ATTRS
			p: CommandTargetRef & {
				attrs: Partial<EffectAttrs>
			}
	  }
	| {
			c: typeof CMD.EFFECT_REORDER
			p: CommandTargetRef & {
				effectId: EntityId
				toIndex: number
			}
	  }
	| {
			c: typeof CMD.EFFECT_REMOVE
			p: CommandTargetRef & {
				effectId: EntityId
			}
	  }

export type Patch =
	| {
			c: typeof PATCH.REGISTRY_SET
			p: { registry: ProjectRegistry }
	  }
	| {
			c: typeof PATCH.PROJECT_SET
			p: { project: ProjectGraph }
	  }
	| {
			c: typeof PATCH.ENTITY_SET
			p: { entity: Entity }
	  }
	| {
			c: typeof PATCH.ENTITY_DELETE
			p: { id: EntityId }
	  }
	| {
			c: typeof PATCH.ATTRS_MERGE
			p: { id: EntityId; attrs: Record<string, unknown> }
	  }
	| {
			c: typeof PATCH.SCALAR_SET
			p: { id: EntityId; path: string; value: number }
	  }
	| {
			c: typeof PATCH.REL_SPLICE
			p: {
				id: EntityId
				rel: string
				index: number
				deleteCount: number
				insert: EntityId[]
			}
	  }
	| {
			c: typeof PATCH.WORKSPACE_ACTIVE_PROJECT_SET
			p: { projectId: ProjectId }
	  }

export interface DispatchResult {
	envelope: PatchEnvelope
	createdIds?: Partial<Record<'projectId' | 'resourceId' | 'clipId' | 'audioClipId' | 'effectId', EntityId>>
	deletedIds?: EntityId[]
}

export interface HistoryState {
	canUndo: boolean
	canRedo: boolean
}

export interface WireMessage<Payload = unknown> {
	m: (typeof MSG)[keyof typeof MSG]
	requestId?: string
	p?: Payload
	meta?: WireProtocolMeta
}
