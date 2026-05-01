export type ProjectId = string
export type EntityId = string
export type RelValue = EntityId | EntityId[] | null

export type EntityType = 'project' | 'timeline' | 'track' | 'resource' | 'clip'

export interface Entity {
	id: EntityId
	type: EntityType
	attrs: Record<string, unknown>
	rels: Record<string, RelValue>
}

export interface ProjectGraph {
	id: ProjectId
	version: number
	rootEntityId: EntityId
	entities: Record<EntityId, Entity>
}

export interface ProjectRegistry {
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
}

export interface ResourceAttrs {
	name: string
	kind: 'video' | 'audio' | 'image'
	duration: number
	status: 'ready' | 'loading' | 'error'
}

export interface TrackAttrs {
	kind: 'video' | 'audio'
	name: string
	height: number
}

export interface ClipAttrs {
	name: string
	start: number
	duration: number
	opacity: number
}

export interface PatchEnvelope {
	projectId: ProjectId
	version: number
	patches: Patch[]
}

export const MSG = {
	SNAPSHOT: -2,
	PATCHES: -4,
	ERROR: -5,
} as const

export const CMD = {
	PROJECT_CREATE: -100,
	RESOURCE_IMPORT: -110,
	TIMELINE_ADD_CLIP: -120,
	TIMELINE_MOVE_CLIP: -121,
	TIMELINE_SPLIT_CLIP: -122,
	CLIP_UPDATE_ATTRS: -130,
} as const

export const PATCH = {
	PROJECT_SET: -200,
	ENTITY_SET: -210,
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
			p: {
				projectId: ProjectId
				clipId: EntityId
				delta: number
			}
	  }
	| {
			c: typeof CMD.TIMELINE_SPLIT_CLIP
			p: {
				projectId: ProjectId
				clipId: EntityId
				time: number
			}
	  }
	| {
			c: typeof CMD.CLIP_UPDATE_ATTRS
			p: {
				projectId: ProjectId
				clipId: EntityId
				attrs: Partial<ClipAttrs>
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
	createdIds?: Partial<Record<'projectId' | 'resourceId' | 'clipId', EntityId>>
}
