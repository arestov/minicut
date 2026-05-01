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

export interface ResourceAttrs {
	name: string
	kind: 'video' | 'audio' | 'image'
	url: string
	mime: string
	duration: number
	width?: number
	height?: number
	status: 'ready' | 'loading' | 'error'
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
	start: number
	duration: number
	in: number
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
} as const

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
} as const

export const PATCH = {
	PROJECT_SET: -200,
	ENTITY_SET: -210,
	ENTITY_DELETE: -211,
	ATTRS_MERGE: -220,
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
				kind: 'blur' | 'sharpen' | 'tint'
				amount: number
			}
	  }

export type Patch =
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
	createdIds?: Partial<Record<'projectId' | 'resourceId' | 'clipId' | 'effectId', EntityId>>
	deletedIds?: EntityId[]
}

export interface WireMessage<Payload = unknown> {
	m: (typeof MSG)[keyof typeof MSG]
	requestId?: string
	p?: Payload
}
