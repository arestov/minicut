import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { ExportProgressEvent, ExportRenderResult, ExportRange } from '../render/exportRenderer'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateEditorHarnessAdapterOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100
let projectSequence = 0
let projectTitleSequence = 0

const createSourceId = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`

const getRootScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => env.pageRuntime?.getRootScope() ?? null

// Reading a direct rel on root — not traversal
const getActiveProjectScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => {
const rootScope = getRootScope(env)
if (!rootScope || !env.pageRuntime) {
return null
}
const activeProject = env.pageRuntime.readOne(rootScope, 'activeProject')
if (activeProject) {
	return activeProject
}

const pioneerScope = env.pageRuntime.readOne(rootScope, 'pioneer')
if (!pioneerScope) {
	return null
}

const projects = env.pageRuntime.readMany(pioneerScope, 'project')
return projects[0] ?? null
}

// Reading a direct rel on root — not traversal
const getSelectedClipScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => {
const rootScope = getRootScope(env)
if (!rootScope || !env.pageRuntime) {
return null
}
return env.pageRuntime.readOne(rootScope, 'selectedClip')
}

const dispatchRoot = (env: EditorActionEnvironment, actionName: string, payload?: unknown): void => {
env.dkt?.dispatch(actionName, payload, getRootScope(env))
}

const dispatchProject = (env: EditorActionEnvironment, actionName: string, payload?: unknown): void => {
const projectScope = getActiveProjectScope(env)
if (!projectScope) {
return
}
env.dkt?.dispatch(actionName, payload, projectScope)
}

const dispatchSelectedClipAction = (env: EditorActionEnvironment, actionName: string, payload?: unknown): void => {
const clipScope = getSelectedClipScope(env)
if (!clipScope) {
return
}
env.dkt?.dispatch(actionName, payload, clipScope)
}

// For byId clip methods: dispatches to selectedClip scope.
// In real UI, components dispatch from their own scope. In harness, select the clip first.
const dispatchClipActionById = (env: EditorActionEnvironment, _clipId: string, actionName: string, payload?: unknown): void => {
dispatchSelectedClipAction(env, actionName, payload)
}

const _resourceChunkSizeRef = new WeakMap<EditorActionEnvironment, number>()

const getTrackScopeByKind = (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
	kind: 'video' | 'audio',
): ReactSyncScopeHandle | null => {
	if (!env.pageRuntime) {
		return null
	}
	const trackScopes = env.pageRuntime.readMany(projectScope, 'tracks')
	for (const trackScope of trackScopes) {
		const attrs = env.pageRuntime.readAttrs(trackScope, ['kind']) as { kind?: unknown }
		if (attrs.kind === kind) {
			return trackScope
		}
	}
	return null
}

const getResourceAttrsById = (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
	sourceResourceId: string,
): { name: string; kind: 'video' | 'audio' | 'image' | 'text'; duration: number } | null => {
	if (!env.pageRuntime) {
		return null
	}
	const resourceScopes = env.pageRuntime.readMany(projectScope, 'resources')
	for (const resourceScope of resourceScopes) {
		const attrs = env.pageRuntime.readAttrs(resourceScope, ['sourceResourceId', 'name', 'kind', 'duration']) as {
			sourceResourceId?: unknown; name?: unknown; kind?: unknown; duration?: unknown
		}
		if (attrs.sourceResourceId !== sourceResourceId) {
			continue
		}
		return {
			name: typeof attrs.name === 'string' ? attrs.name : 'Clip',
			kind: attrs.kind === 'audio' || attrs.kind === 'image' || attrs.kind === 'text' ? attrs.kind : 'video',
			duration: typeof attrs.duration === 'number' ? attrs.duration : 0,
		}
	}
	return null
}

const dispatchTrackClip = (
	env: EditorActionEnvironment,
	trackScope: ReactSyncScopeHandle | null,
	payload: {
		sourceClipId: string
		sourceResourceId: string
		name: string
		mediaKind: string
		start: number
		in: number
		duration: number
		sourceResourceName?: string | null
	},
): void => {
	if (!trackScope || !env.dkt) {
		return
	}
	env.dkt.dispatch('addClip', payload, trackScope)
}

const isTimelineEmpty = (env: EditorActionEnvironment, projectScope: ReactSyncScopeHandle): boolean => {
	if (!env.pageRuntime) {
		return true
	}
	const attrs = env.pageRuntime.readAttrs(projectScope, ['timelineDuration']) as { timelineDuration?: unknown }
	return typeof attrs.timelineDuration !== 'number' || attrs.timelineDuration <= 0
}

const waitForActiveProjectScope = async (env: EditorActionEnvironment): Promise<ReactSyncScopeHandle | null> => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const scope = getActiveProjectScope(env)
		if (scope) {
			return scope
		}
		await new Promise((resolve) => setTimeout(resolve, 25))
	}

	return null
}

const importFilesDirectly = (env: EditorActionEnvironment, files: File[]): void => {
	const resourceChunkSize = _resourceChunkSizeRef.get(env) ?? 1024 * 1024
	void (async () => {
		const projectScope = await waitForActiveProjectScope(env)
		if (!projectScope) {
			return
		}
		for (const file of files) {
			const kind = env.media.getFileKind(file)
			if (!kind) {
				continue
			}
			const objectUrl = env.media.createObjectUrl(file)
			if (!objectUrl) {
				continue
			}
			env.lifecycle.registerObjectUrl(objectUrl, 'import')
			const duration = await env.media.getImportedResourceDuration(objectUrl, kind)
			const sourceResourceId = createSourceId('resource')
			const shouldAddEmbeddedAudio = kind === 'video' && isTimelineEmpty(env, projectScope)
			env.dkt?.dispatch('importResource', {
				sourceResourceId,
				name: file.name,
				kind,
				url: objectUrl,
				mime: file.type || 'application/octet-stream',
				duration,
				size: file.size,
				source: { kind: 'local', ownerPeerId: env.transfers.getPeerId() },
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: resourceChunkSize,
					chunks: {},
					ranges: { loaded: [[0, file.size]], requested: [] },
					loadedBytes: file.size,
				},
			}, projectScope)
			if (shouldAddEmbeddedAudio) {
				env.lifecycle.setTimeout(() => {
					env.dkt?.dispatch('addEmbeddedAudioToTimeline', { sourceResourceId }, projectScope)
				}, 0)
			}
			env.transfers.manager.registerLocalResource(sourceResourceId, file, {
				objectUrl,
				kind,
				mime: file.type || 'application/octet-stream',
				duration,
				size: file.size,
				chunkSize: resourceChunkSize,
				ownerPeerId: env.transfers.getPeerId(),
				sourceKind: 'local',
				fallbackUrl: objectUrl,
				name: file.name,
			})
		}
	})().catch(() => undefined)
}

type ExportEntity = {
	id: string
	type: 'project' | 'timeline' | 'track' | 'resource' | 'clip' | 'effect' | 'text'
	attrs: Record<string, unknown>
	rels: Record<string, string | string[] | null>
}

type ExportGraph = {
	activeProjectId: string | null
	projects: Record<string, { id: string; version: number; rootEntityId: string }>
	entitiesById: Record<string, ExportEntity>
}

const asEntityId = (scope: ReactSyncScopeHandle, sourceId: unknown, fallbackPrefix: string): string =>
	typeof sourceId === 'string' && sourceId ? sourceId : `${fallbackPrefix}:${scope._nodeId}`

const createExportGraph = (env: EditorActionEnvironment, projectScope: ReactSyncScopeHandle): ExportGraph | null => {
	if (!env.pageRuntime) {
		return null
	}

	const projectAttrs = env.pageRuntime.readAttrs(projectScope, ['sourceProjectId', 'title', 'fps', 'width', 'height', 'duration']) as {
		sourceProjectId?: unknown
		title?: unknown
		fps?: unknown
		width?: unknown
		height?: unknown
		duration?: unknown
	}
	const projectId = asEntityId(projectScope, projectAttrs.sourceProjectId, 'project')
	const timelineId = `${projectId}:timeline`
	const entitiesById: Record<string, ExportEntity> = {}

	const trackScopes = env.pageRuntime.readMany(projectScope, 'tracks')
	const resourceScopes = env.pageRuntime.readMany(projectScope, 'resources')
	const resourceIdsBySourceId = new Map<string, string>()

	const resourceIds: string[] = []
	for (const resourceScope of resourceScopes) {
		const attrs = env.pageRuntime.readAttrs(resourceScope, [
			'sourceResourceId', 'name', 'kind', 'url', 'mime', 'duration', 'width', 'height', 'size', 'source', 'status', 'data',
		]) as Record<string, unknown>
		const resourceId = asEntityId(resourceScope, attrs.sourceResourceId, 'resource')
		if (typeof attrs.sourceResourceId === 'string' && attrs.sourceResourceId) {
			resourceIdsBySourceId.set(attrs.sourceResourceId, resourceId)
		}
		resourceIds.push(resourceId)
		entitiesById[resourceId] = {
			id: resourceId,
			type: 'resource',
			attrs,
			rels: {},
		}
	}

	const clipsByResource = new Map<string, Array<{ id: string; mediaKind: string }>>()
	const trackIds: string[] = []
	for (const trackScope of trackScopes) {
		const trackAttrs = env.pageRuntime.readAttrs(trackScope, ['sourceTrackId', 'kind', 'name', 'muted', 'locked', 'height']) as Record<string, unknown>
		const trackId = asEntityId(trackScope, trackAttrs.sourceTrackId, 'track')
		trackIds.push(trackId)

		const clipIds: string[] = []
		const clipScopes = env.pageRuntime.readMany(trackScope, 'clips')
		for (const clipScope of clipScopes) {
			const clipAttrs = env.pageRuntime.readAttrs(clipScope, [
				'sourceClipId', 'sourceResourceId', 'sourceTextId', 'name', 'mediaKind', 'start', 'in', 'duration',
				'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform',
			]) as Record<string, unknown>
			const clipId = asEntityId(clipScope, clipAttrs.sourceClipId, 'clip')
			clipIds.push(clipId)

			const rels: Record<string, string | string[] | null> = {}
			const sourceResourceId = typeof clipAttrs.sourceResourceId === 'string' ? clipAttrs.sourceResourceId : null
			if (sourceResourceId) {
				const resourceId = resourceIdsBySourceId.get(sourceResourceId) ?? sourceResourceId
				rels.resource = resourceId
			}

			const textScope = env.pageRuntime.readOne(clipScope, 'text')
			if (textScope) {
				const textAttrs = env.pageRuntime.readAttrs(textScope, ['sourceTextId', 'content', 'style', 'box']) as Record<string, unknown>
				const textId = asEntityId(textScope, textAttrs.sourceTextId, 'text')
				rels.text = textId
				if (!entitiesById[textId]) {
					entitiesById[textId] = {
						id: textId,
						type: 'text',
						attrs: textAttrs,
						rels: {},
					}
				}
			}

			const effectScopes = env.pageRuntime.readMany(clipScope, 'effects')
			const effectIds: string[] = []
			for (const effectScope of effectScopes) {
				const effectAttrs = env.pageRuntime.readAttrs(effectScope, ['sourceEffectId', 'name', 'kind', 'enabled', 'amount', 'params', 'color']) as Record<string, unknown>
				const effectId = asEntityId(effectScope, effectAttrs.sourceEffectId, 'effect')
				effectIds.push(effectId)
				entitiesById[effectId] = {
					id: effectId,
					type: 'effect',
					attrs: effectAttrs,
					rels: { clip: clipId },
				}
			}
			rels.effects = effectIds

			entitiesById[clipId] = {
				id: clipId,
				type: 'clip',
				attrs: clipAttrs,
				rels,
			}

			if (sourceResourceId) {
				const mediaKind = typeof clipAttrs.mediaKind === 'string' ? clipAttrs.mediaKind : ''
				const entries = clipsByResource.get(sourceResourceId) ?? []
				entries.push({ id: clipId, mediaKind })
				clipsByResource.set(sourceResourceId, entries)
			}
		}

		entitiesById[trackId] = {
			id: trackId,
			type: 'track',
			attrs: trackAttrs,
			rels: { clips: clipIds },
		}
	}

	for (const entries of clipsByResource.values()) {
		const videoClip = entries.find((entry) => entry.mediaKind === 'video')
		const audioClip = entries.find((entry) => entry.mediaKind === 'audio')
		if (!videoClip || !audioClip) {
			continue
		}
		const videoEntity = entitiesById[videoClip.id]
		const audioEntity = entitiesById[audioClip.id]
		if (videoEntity?.type === 'clip') {
			videoEntity.rels.linkedAudioClip = audioClip.id
		}
		if (audioEntity?.type === 'clip') {
			audioEntity.rels.linkedVideoClip = videoClip.id
		}
	}

	entitiesById[timelineId] = {
		id: timelineId,
		type: 'timeline',
		attrs: {
			name: 'Timeline',
			duration: typeof projectAttrs.duration === 'number' ? projectAttrs.duration : 0,
		},
		rels: { tracks: trackIds },
	}

	entitiesById[projectId] = {
		id: projectId,
		type: 'project',
		attrs: {
			title: typeof projectAttrs.title === 'string' ? projectAttrs.title : 'Project',
			fps: typeof projectAttrs.fps === 'number' ? projectAttrs.fps : 30,
			width: typeof projectAttrs.width === 'number' ? projectAttrs.width : 1280,
			height: typeof projectAttrs.height === 'number' ? projectAttrs.height : 720,
			duration: typeof projectAttrs.duration === 'number' ? projectAttrs.duration : 0,
		},
		rels: {
			activeTimeline: timelineId,
			resources: resourceIds,
		},
	}

	return {
		activeProjectId: projectId,
		projects: {
			[projectId]: {
				id: projectId,
				version: 1,
				rootEntityId: projectId,
			},
		},
		entitiesById,
	}
}

const queueExport = async (
	env: EditorActionEnvironment,
	range: ExportRange,
	onProgress?: (event: ExportProgressEvent) => void,
): Promise<ExportRenderResult | null> => {
	const projectScope = getActiveProjectScope(env)
	if (!projectScope) {
		return null
	}

	const graph = createExportGraph(env, projectScope)
	if (!graph || !graph.activeProjectId) {
		return null
	}

	try {
		const result = await env.export.render({
			registry: graph as unknown as Parameters<EditorActionEnvironment['export']['render']>[0]['registry'],
			projectId: graph.activeProjectId,
			range,
			format: 'video-webm',
		}, onProgress)
		const downloadUrl = env.media.createObjectUrl(result.blob)
		if (downloadUrl) {
			env.lifecycle.registerObjectUrl(downloadUrl, 'export')
			result.downloadUrl = downloadUrl
		}
		return result
	} catch {
		return null
	}
}

export const createEditorHarnessAdapter = (
env: EditorActionEnvironment,
_options: CreateEditorHarnessAdapterOptions,
): VideoEditorHarnessActions => {
_resourceChunkSizeRef.set(env, _options.resourceChunkSize)

return ({
createProject(title?: string): void {
const resolvedTitle = typeof title === 'string' && title ? title : `Project ${++projectTitleSequence}`
const sourceProjectId = `project:${++projectSequence}:${Date.now().toString(36)}`
dispatchRoot(env, 'createProject', { title: resolvedTitle, sourceProjectId })
},
setActiveProject(projectId: string): void {
dispatchRoot(env, 'setActiveProject', projectId)
},
importSampleResource(): void {
dispatchRoot(env, 'importSampleResource')
},
importFiles(files: FileList | File[]): void {
const importedFiles = Array.from(files)
if (importedFiles.length === 0) {
return
}
			importFilesDirectly(env, importedFiles)
},
addResourceToTimeline(resourceId: string): void {
	const projectScope = getActiveProjectScope(env)
	if (!projectScope) {
		return
	}
	const resource = getResourceAttrsById(env, projectScope, resourceId)
	if (!resource) {
		return
	}
	if (resource.kind !== 'audio') {
		const videoTrackScope = getTrackScopeByKind(env, projectScope, 'video')
		dispatchTrackClip(env, videoTrackScope, {
			sourceClipId: `${resourceId}:clip`,
			sourceResourceId: resourceId,
			name: resource.name,
			mediaKind: resource.kind,
			start: 0,
			in: 0,
			duration: resource.duration,
		})
	}
	if (resource.kind === 'audio' || resource.kind === 'video') {
		const audioTrackScope = getTrackScopeByKind(env, projectScope, 'audio')
		dispatchTrackClip(env, audioTrackScope, {
			sourceClipId: resource.kind === 'video' ? `${resourceId}:audio-clip` : `${resourceId}:clip`,
			sourceResourceId: resourceId,
			name: resource.kind === 'video' ? 'Embedded audio' : resource.name,
			mediaKind: 'audio',
			start: 0,
			in: 0,
			duration: resource.duration,
			sourceResourceName: resource.kind === 'video' ? resource.name : null,
		})
	}
},
addTextClip(content?: string): void {
const sourceTextId = createSourceId('text')
const sourceClipId = createSourceId('clip')
dispatchRoot(env, 'addTextClipToTimeline', {
sourceClipId,
sourceTextId,
name: 'Text',
mediaKind: 'text',
start: 0,
in: 0,
duration: 3,
text: {
sourceTextId,
content: typeof content === 'string' && content ? content : 'Text',
},
})
},
addTrack(kind: 'video' | 'audio'): void {
dispatchProject(env, 'addTrack', { kind })
},
selectEntity(entityId: string | null): void {
dispatchRoot(env, 'selectEntity', entityId)
},
setActiveInspectorTab(tab): void {
dispatchRoot(env, 'setActiveInspectorTab', tab)
},
renameClipById(clipId: string, name: string): void {
dispatchClipActionById(env, clipId, 'rename', { name })
},
renameSelectedClip(name: string): void {
dispatchSelectedClipAction(env, 'rename', { name })
},
colorClipById(clipId: string, color: string): void {
dispatchClipActionById(env, clipId, 'color', { color })
},
colorSelectedClip(color: string): void {
dispatchSelectedClipAction(env, 'color', { color })
},
updateClipOpacityById(clipId: string, opacityPercent: number): void {
dispatchClipActionById(env, clipId, 'updateOpacity', { opacityPercent })
},
updateSelectedClipOpacity(opacityPercent: number): void {
dispatchSelectedClipAction(env, 'updateOpacity', { opacityPercent })
},
updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void {
dispatchClipActionById(env, clipId, 'setFade', { edge, delta })
},
updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
dispatchSelectedClipAction(env, 'setFade', { edge, delta })
},
updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
dispatchClipActionById(env, clipId, 'setTransform', partial)
},
updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
dispatchSelectedClipAction(env, 'setTransform', partial)
},
updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void {
dispatchClipActionById(env, clipId, 'setAudio', partial)
},
updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
dispatchSelectedClipAction(env, 'setAudio', partial)
},
trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
dispatchClipActionById(env, clipId, 'trim', { edge, delta })
},
trimSelectedClip(edge: 'start' | 'end', delta: number): void {
dispatchSelectedClipAction(env, 'trim', { edge, delta })
},
resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
dispatchClipActionById(env, clipId, 'resize', { edge, delta })
},
addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void {
dispatchClipActionById(env, clipId, 'addEffect', { kind })
},
addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
dispatchSelectedClipAction(env, 'addEffect', { kind })
},
addColorCorrectionToClip(clipId: string): void {
dispatchClipActionById(env, clipId, 'addEffect', { kind: 'color-correction', name: 'Color correction' })
},
addColorCorrectionToSelectedClip(): void {
dispatchSelectedClipAction(env, 'addEffect', { kind: 'color-correction', name: 'Color correction' })
},
deleteClipById(_clipId: string): void {
dispatchRoot(env, 'deleteSelectedClip')
},
deleteSelectedClip(): void {
dispatchRoot(env, 'deleteSelectedClip')
},
splitSelectedClip(): void {
dispatchRoot(env, 'splitSelectedClip')
},
splitClipByIdAt(_clipId: string, time: number): void {
dispatchSelectedClipAction(env, 'splitSelfAt', { time: roundToHundredths(time) })
},
removeEffectFromClip(_clipId: string, effectId: string): void {
dispatchSelectedClipAction(env, 'removeEffect', { effectId })
},
removeEffectFromSelectedClip(effectId: string): void {
dispatchSelectedClipAction(env, 'removeEffect', { effectId })
},
queueClipExportById(clipId: string, onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null> {
	return queueExport(env, { type: 'clip', clipId }, onProgress)
},
queueSelectedClipExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null> {
	const selectedClipScope = getSelectedClipScope(env)
	if (!selectedClipScope || !env.pageRuntime) {
		return Promise.resolve(null)
	}
	const attrs = env.pageRuntime.readAttrs(selectedClipScope, ['sourceClipId']) as { sourceClipId?: unknown }
	const clipId = typeof attrs.sourceClipId === 'string' && attrs.sourceClipId ? attrs.sourceClipId : selectedClipScope._nodeId
	return queueExport(env, { type: 'clip', clipId }, onProgress)
},
queueProjectExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null> {
	return queueExport(env, { type: 'project' }, onProgress)
},
nudgeSelectedClip(delta: number): void {
dispatchSelectedClipAction(env, 'moveBy', { delta })
},
moveClipById(_clipId: string, delta: number): void {
dispatchSelectedClipAction(env, 'moveBy', { delta })
},
togglePlayback(): void {
dispatchRoot(env, 'togglePlayback')
},
setCursor(value: number): void {
dispatchRoot(env, 'setCursor', value)
},
tickPlayback(deltaSeconds: number): void {
dispatchRoot(env, 'tickPlayback', { deltaSeconds })
},
zoomTimeline(delta: number): void {
dispatchRoot(env, 'zoomTimeline', { delta })
},
})
}