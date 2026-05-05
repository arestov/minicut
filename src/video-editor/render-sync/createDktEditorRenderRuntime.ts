import { getTrackEnd, getTrackForClip } from '../domain/selectors'
import type {
	ClipAttrs,
	EditorSessionState,
	Entity,
	EntityId,
	EffectAttrs,
	ProjectRegistry,
	TextAttrs,
} from '../domain/types'
import type { ResourceTransferView } from '../media/resourceTransferManager'
import type { RegistryRenderSource } from './DktRegistryRenderStore'
import {
	createEntityScope,
	ROOT_SCOPE,
	SESSION_SCOPE,
	type EditorScope,
} from './EditorScope'
import type { EditorRenderRuntime, EditorScopedDispatch } from './EditorRenderRuntime'

type HarnessActions = {
	addColorCorrectionToClip(clipId: string): void
	addResourceToTimeline(resourceId: string): void
	addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void
	addTextClip(content?: string): void
	addTrack(kind: 'video' | 'audio'): void
	colorClipById(clipId: string, color: string): void
	createProject(title?: string): void
	deleteClipById(clipId: string): void
	deleteSelectedClip(): void
	importFiles(files: FileList | File[]): void
	importSampleResource(): void
	moveClipById(clipId: string, delta: number): void
	nudgeSelectedClip(delta: number): void
	removeEffectFromClip(clipId: string, effectId: string): void
	renameClipById(clipId: string, name: string): void
	resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void
	selectEntity(entityId: string | null): void
	setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void
	setActiveProject(projectId: string): void
	splitClipByIdAt(clipId: string, time: number): void
	splitSelectedClip(): void
	tickPlayback(deltaSeconds: number): void
	trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void
	togglePlayback(): void
	setCursor(value: number): void
	updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void
	updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void
	updateClipOpacityById(clipId: string, opacityPercent: number): void
	updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void
	updateEffectAttrs(effectId: string, attrs: Partial<EffectAttrs>): void
	updateTextById(textId: string, attrs: Partial<TextAttrs>): void
	zoomTimeline(delta: number): void
}

export interface ClipTimelineEditBounds {
	previousEnd: number
	nextStart: number | null
}

export interface SelectedClipSummary {
	clipId: string
	color: string
	resourceName: string
	trackName: string
}

export interface ClipTrackPositionSummary {
	trackName: string
	ordinal: number
}

export interface CreateDktEditorRenderRuntimeOptions {
	registry: RegistryRenderSource
	session: {
		getSnapshot(): EditorSessionState
		subscribe(listener: () => void): () => void
		subscribeFields(fields: readonly string[], listener: () => void): () => void
	}
	resourceTransfers: {
		getSnapshot(): Record<string, ResourceTransferView>
		subscribe(listener: () => void): () => void
	}
	actions: HarnessActions
}

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs

const combineCleanups = (cleanups: Array<() => void>): (() => void) => {
	let active = true

	return () => {
		if (!active) {
			return
		}

		active = false
		for (let index = cleanups.length - 1; index >= 0; index -= 1) {
			cleanups[index]()
		}
	}
}

const getEntityScope = (registry: ProjectRegistry, nodeId: EntityId | null | undefined): EditorScope | null => {
	const entity = nodeId ? registry.entitiesById[nodeId] : null
	return entity ? createEntityScope(entity.id, entity.type) : null
}

const getEntityAttrs = (registry: ProjectRegistry, scope: EditorScope): Record<string, unknown> | null => {
	const entity = registry.entitiesById[scope.nodeId]
	return entity?.attrs ?? null
}

const getEntityRels = (registry: ProjectRegistry, scope: EditorScope): Record<string, unknown> | null => {
	const entity = registry.entitiesById[scope.nodeId]
	return entity?.rels ?? null
}

const getActiveProjectId = (registry: ProjectRegistry, session: EditorSessionState): string | null =>
	session.activeProjectId ?? registry.activeProjectId

const getActiveProjectScope = (registry: ProjectRegistry, session: EditorSessionState): EditorScope | null => {
	const projectId = getActiveProjectId(registry, session)
	const rootEntityId = projectId ? registry.projects[projectId]?.rootEntityId : null
	return getEntityScope(registry, rootEntityId)
}

const getRelScope = (registry: ProjectRegistry, scope: EditorScope, relName: string): EditorScope | null => {
	const relValue = getEntityRels(registry, scope)?.[relName]
	return typeof relValue === 'string' ? getEntityScope(registry, relValue) : null
}

const getManyRelScopes = (registry: ProjectRegistry, scope: EditorScope, relName: string): EditorScope[] => {
	const relValue = getEntityRels(registry, scope)?.[relName]
	return Array.isArray(relValue)
		? relValue.flatMap((nodeId) => {
				const childScope = getEntityScope(registry, nodeId)
				return childScope ? [childScope] : []
			})
		: []
}

const getClipTimelineEditBounds = (registry: ProjectRegistry, clipId: EntityId): ClipTimelineEditBounds | null => {
	const clip = registry.entitiesById[clipId]
	if (!clip || clip.type !== 'clip') {
		return null
	}

	const track = getTrackForClip(registry, clipId)
	if (!track) {
		return { previousEnd: 0, nextStart: null }
	}

	const clipAttrs = asClipAttrs(clip.attrs)
	const clipEnd = clipAttrs.start + clipAttrs.duration
	const siblingClips = (Array.isArray(track.rels.clips) ? track.rels.clips : [])
		.map((siblingId) => registry.entitiesById[siblingId])
		.filter((entity): entity is Entity => Boolean(entity) && entity.type === 'clip' && entity.id !== clipId)

	const previousEnd = siblingClips.reduce((maxEnd, sibling) => {
		const attrs = asClipAttrs(sibling.attrs)
		const siblingEnd = attrs.start + attrs.duration
		return siblingEnd <= clipAttrs.start ? Math.max(maxEnd, siblingEnd) : maxEnd
	}, 0)
	const nextStart = siblingClips.reduce<number | null>((minStart, sibling) => {
		const attrs = asClipAttrs(sibling.attrs)
		if (attrs.start < clipEnd) {
			return minStart
		}

		return minStart === null ? attrs.start : Math.min(minStart, attrs.start)
	}, null)

	return { previousEnd, nextStart }
}

const hasActiveColorGrade = (registry: ProjectRegistry, clipId: EntityId): boolean => {
	const effectIds = registry.entitiesById[clipId]?.rels.effects
	if (!Array.isArray(effectIds)) {
		return false
	}

	return effectIds.some((effectId) => {
		const effect = registry.entitiesById[effectId]
		return effect?.type === 'effect'
			&& effect.attrs.kind === 'color-correction'
			&& effect.attrs.enabled !== false
	})
}

const getSelectedClipSummary = (registry: ProjectRegistry, session: EditorSessionState): SelectedClipSummary | null => {
	const selectedEntityId = session.selectedEntityId
	const clip = selectedEntityId ? registry.entitiesById[selectedEntityId] : null
	if (!clip || clip.type !== 'clip') {
		return null
	}

	const track = getTrackForClip(registry, clip.id)
	const resourceId = typeof clip.rels.resource === 'string' ? clip.rels.resource : null
	const resource = resourceId ? registry.entitiesById[resourceId] : null
	const attrs = asClipAttrs(clip.attrs)

	return {
		clipId: clip.id,
		color: String(attrs.color ?? '#2563eb'),
		resourceName: String(resource?.attrs.name ?? attrs.name),
		trackName: String(track?.attrs.name ?? 'Track'),
	}
}

const getClipTrackPositionSummary = (registry: ProjectRegistry, clipId: EntityId): ClipTrackPositionSummary | null => {
	const track = getTrackForClip(registry, clipId)
	if (!track) {
		return null
	}

	const clipIds = Array.isArray(track.rels.clips) ? track.rels.clips : []
	return {
		trackName: String(track.attrs.name ?? 'Track'),
		ordinal: Math.max(1, clipIds.indexOf(clipId) + 1),
	}
}

const asNumberPayload = (payload: unknown, key: string): number | null => {
	const value = (payload as Record<string, unknown> | null)?.[key]
	return typeof value === 'number' ? value : null
}

const asStringPayload = (payload: unknown, key: string): string | null => {
	const value = (payload as Record<string, unknown> | null)?.[key]
	return typeof value === 'string' ? value : null
}

const cloneSnapshotValue = (value: unknown): unknown => {
	if (!value || typeof value !== 'object') {
		return value
	}

	return structuredClone(value)
}

export const createDktEditorRenderRuntime = ({
	registry,
	session,
	resourceTransfers,
	actions,
}: CreateDktEditorRenderRuntimeOptions): EditorRenderRuntime => {
	const readOne = (scope: EditorScope, relName: string): EditorScope | null => {
		const registrySnapshot = registry.getSnapshot()
		const sessionSnapshot = session.getSnapshot()
		if (scope.type === 'root' && relName === 'activeProject') {
			return getActiveProjectScope(registrySnapshot, sessionSnapshot)
		}
		if (scope.type === 'session' && relName === 'selectedEntity') {
			return getEntityScope(registrySnapshot, sessionSnapshot.selectedEntityId)
		}

		return getRelScope(registrySnapshot, scope, relName)
	}

	const runtime: EditorRenderRuntime = {
		getRootScope: () => ROOT_SCOPE,
		getSessionScope: () => SESSION_SCOPE,

		readAttrs(scope, fields) {
			const source = scope.type === 'session'
				? session.getSnapshot() as unknown as Record<string, unknown>
					: scope.type === 'root'
						? {
							activeProjectId: getActiveProjectId(registry.getSnapshot(), session.getSnapshot()),
							projectCount: Object.keys(registry.getSnapshot().projects).length,
						}
						: getEntityAttrs(registry.getSnapshot(), scope) ?? {}

			return Object.fromEntries(fields.map((field) => [field, cloneSnapshotValue(source[field])]))
		},

		subscribeAttrs(scope, fields, listener) {
			if (scope.type === 'session') {
				return session.subscribeFields(fields, listener)
			}
			return scope.type === 'root'
				? combineCleanups([registry.subscribe(listener), session.subscribeFields(['activeProjectId'], listener)])
				: registry.subscribe(listener)
		},

		readOne,

		subscribeOne(scope, relName, listener) {
			if (scope.type === 'root' && relName === 'activeProject') {
				return combineCleanups([registry.subscribe(listener), session.subscribeFields(['activeProjectId'], listener)])
			}
			if (scope.type === 'session' && relName === 'selectedEntity') {
				return session.subscribeFields(['selectedEntityId'], listener)
			}

			return registry.subscribe(listener)
		},

		readMany(scope, relName) {
			const registrySnapshot = registry.getSnapshot()
			if (scope.type === 'root' && relName === 'projects') {
				return Object.values(registrySnapshot.projects).flatMap((project) => {
					const projectScope = getEntityScope(registrySnapshot, project.rootEntityId)
					return projectScope ? [projectScope] : []
				})
			}

			return getManyRelScopes(registrySnapshot, scope, relName)
		},

		subscribeMany(scope, relName, listener) {
			return registry.subscribe(listener)
		},

		readComp(scope, compName) {
			const registrySnapshot = registry.getSnapshot()
			const sessionSnapshot = session.getSnapshot()
			if (scope.type === 'project' && compName === 'projectVersion') {
				const project = Object.values(registrySnapshot.projects).find((candidate) => candidate.rootEntityId === scope.nodeId)
				return project?.version ?? 0
			}
			if (scope.type === 'project' && compName === 'resourceCount') {
				const resources = registrySnapshot.entitiesById[scope.nodeId]?.rels.resources
				return Array.isArray(resources) ? resources.length : 0
			}
			if (scope.type === 'project' && compName === 'projectId') {
				return Object.values(registrySnapshot.projects).find((candidate) => candidate.rootEntityId === scope.nodeId)?.id ?? null
			}
			if (scope.type === 'resource' && compName === 'resourceTransfer') {
				return resourceTransfers.getSnapshot()[scope.nodeId] ?? null
			}
			if (scope.type === 'track' && compName === 'trackEnd') {
				return getTrackEnd(registrySnapshot, scope.nodeId)
			}
			if (scope.type === 'clip' && compName === 'timelineEditBounds') {
				return getClipTimelineEditBounds(registrySnapshot, scope.nodeId)
			}
			if (scope.type === 'clip' && compName === 'hasActiveColorGrade') {
				return hasActiveColorGrade(registrySnapshot, scope.nodeId)
			}
			if (scope.type === 'clip' && compName === 'trackPosition') {
				return getClipTrackPositionSummary(registrySnapshot, scope.nodeId)
			}
			if (scope.type === 'session' && compName === 'selectedClipSummary') {
				return getSelectedClipSummary(registrySnapshot, sessionSnapshot)
			}

			return null
		},

		subscribeComp(_scope, _compName, listener) {
			return combineCleanups([
				registry.subscribe(listener),
				session.subscribe(listener),
				resourceTransfers.subscribe(listener),
			])
		},

		getDispatch(scope = ROOT_SCOPE): EditorScopedDispatch {
			return (actionName, payload) => {
				if (actionName === 'createProject') {
					actions.createProject(typeof payload === 'string' ? payload : undefined)
					return
				}
				if (actionName === 'setActiveProject') {
					const projectId = typeof payload === 'string'
						? payload
						: (payload as Record<string, unknown> | null)?.projectId
					if (typeof projectId === 'string') {
						actions.setActiveProject(projectId)
					}
					return
				}
				if (actionName === 'importSampleResource') {
					actions.importSampleResource()
					return
				}
				if (actionName === 'importFiles') {
					const files = (payload as Record<string, unknown> | null)?.files
					if (files instanceof FileList || Array.isArray(files)) {
						actions.importFiles(files)
					}
					return
				}
				if (actionName === 'addTextClip') {
					actions.addTextClip()
					return
				}
				if (actionName === 'addResourceToTimeline' && scope?.type === 'resource') {
					actions.addResourceToTimeline(scope.nodeId)
					return
				}
				if (actionName === 'setActiveInspectorTab') {
					const tab = (payload as Record<string, unknown> | null)?.tab
					if (tab === 'edit' || tab === 'color' || tab === 'audio' || tab === 'export') {
						actions.setActiveInspectorTab(tab)
					}
					return
				}
				if (actionName === 'tickPlayback') {
					const deltaSeconds = asNumberPayload(payload, 'deltaSeconds')
					if (deltaSeconds !== null) {
						actions.tickPlayback(deltaSeconds)
					}
					return
				}
				if (actionName === 'addTrack') {
					const kind = (payload as Record<string, unknown> | null)?.kind
					if (kind === 'video' || kind === 'audio') {
						actions.addTrack(kind)
					}
					return
				}
				if (actionName === 'setCursor') {
					const value = asNumberPayload(payload, 'value')
					if (value !== null) {
						actions.setCursor(value)
					}
					return
				}
				if (actionName === 'zoomTimeline') {
					const delta = asNumberPayload(payload, 'delta')
					if (delta !== null) {
						actions.zoomTimeline(delta)
					}
					return
				}
				if (actionName === 'togglePlayback') {
					actions.togglePlayback()
					return
				}
				if (actionName === 'splitSelectedClip') {
					actions.splitSelectedClip()
					return
				}
				if (actionName === 'nudgeSelectedClip') {
					const delta = asNumberPayload(payload, 'delta')
					if (delta !== null) {
						actions.nudgeSelectedClip(delta)
					}
					return
				}
				if (actionName === 'deleteSelectedClip') {
					actions.deleteSelectedClip()
					return
				}
				if (scope?.type === 'text' && actionName === 'updateText') {
					actions.updateTextById(scope.nodeId, payload as Partial<TextAttrs>)
					return
				}
				if (scope?.type === 'effect' && actionName === 'updateEffect') {
					actions.updateEffectAttrs(scope.nodeId, payload as Partial<EffectAttrs>)
					return
				}
				if (scope?.type !== 'clip') {
					return
				}

				if (actionName === 'select') {
					actions.selectEntity(scope.nodeId)
					return
				}
				if (actionName === 'moveBy') {
					const delta = asNumberPayload(payload, 'delta')
					if (delta !== null) {
						actions.moveClipById(scope.nodeId, delta)
					}
					return
				}
				if (actionName === 'resize') {
					const edge = (payload as Record<string, unknown> | null)?.edge
					const delta = asNumberPayload(payload, 'delta')
					if ((edge === 'start' || edge === 'end') && delta !== null) {
						actions.resizeClipById(scope.nodeId, edge, delta)
					}
					return
				}
				if (actionName === 'splitAt') {
					const time = asNumberPayload(payload, 'time')
					if (time !== null) {
						actions.splitClipByIdAt(scope.nodeId, time)
					}
					return
				}
				if (actionName === 'rename') {
					const name = asStringPayload(payload, 'name')
					if (name !== null) {
						actions.renameClipById(scope.nodeId, name)
					}
					return
				}
				if (actionName === 'color') {
					const color = asStringPayload(payload, 'color')
					if (color !== null) {
						actions.colorClipById(scope.nodeId, color)
					}
					return
				}
				if (actionName === 'setOpacity') {
					const opacityPercent = asNumberPayload(payload, 'opacityPercent')
					if (opacityPercent !== null) {
						actions.updateClipOpacityById(scope.nodeId, opacityPercent)
					}
					return
				}
				if (actionName === 'setFade') {
					const edge = (payload as Record<string, unknown> | null)?.edge
					const delta = asNumberPayload(payload, 'delta')
					if ((edge === 'in' || edge === 'out') && delta !== null) {
						actions.updateClipFadeById(scope.nodeId, edge, delta)
					}
					return
				}
				if (actionName === 'setTransform') {
					actions.updateClipTransformById(scope.nodeId, payload as Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>)
					return
				}
				if (actionName === 'setAudio') {
					actions.updateClipAudioById(scope.nodeId, payload as Partial<Record<'gain' | 'pan', number>>)
					return
				}
				if (actionName === 'trim') {
					const edge = (payload as Record<string, unknown> | null)?.edge
					const delta = asNumberPayload(payload, 'delta')
					if ((edge === 'start' || edge === 'end') && delta !== null) {
						actions.trimClipById(scope.nodeId, edge, delta)
					}
					return
				}
				if (actionName === 'addEffect') {
					const kind = (payload as Record<string, unknown> | null)?.kind
					if (kind === 'blur' || kind === 'sharpen' || kind === 'tint') {
						actions.addEffectToClip(scope.nodeId, kind)
					}
					return
				}
				if (actionName === 'addColorCorrection') {
					actions.addColorCorrectionToClip(scope.nodeId)
					return
				}
				if (actionName === 'removeEffect') {
					const effectId = asStringPayload(payload, 'effectId')
					if (effectId !== null) {
						actions.removeEffectFromClip(scope.nodeId, effectId)
					}
					return
				}
				if (actionName === 'deleteSelectedClip') {
					actions.deleteClipById(scope.nodeId)
					return
				}
			}
		},
	}

	return runtime
}

