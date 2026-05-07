import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { ExportProgressEvent, ExportRenderResult, ExportRange } from '../render/exportRenderer'
import type { ExportPlan } from '../render/renderPlan'
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

const findClipScopeById = (
	env: EditorActionEnvironment,
	clipId: string,
): ReactSyncScopeHandle | null => {
	if (!env.pageRuntime || !clipId) {
		return null
	}

	const projectScope = getActiveProjectScope(env)
	if (!projectScope) {
		return null
	}

	const trackScopes = env.pageRuntime.readMany(projectScope, 'tracks')
	for (const trackScope of trackScopes) {
		const clipScopes = env.pageRuntime.readMany(trackScope, 'clips')
		for (const clipScope of clipScopes) {
			if (clipScope._nodeId === clipId) {
				return clipScope
			}
			const attrs = env.pageRuntime.readAttrs(clipScope, ['sourceClipId']) as { sourceClipId?: unknown }
			if (attrs.sourceClipId === clipId) {
				return clipScope
			}
		}
	}

	return null
}

const dispatchClipActionById = (env: EditorActionEnvironment, clipId: string, actionName: string, payload?: unknown): void => {
	const clipScope = findClipScopeById(env, clipId)
	if (clipScope) {
		env.dkt?.dispatch(actionName, payload, clipScope)
		return
	}
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

const queueExport = async (
	env: EditorActionEnvironment,
	range: ExportRange,
	onProgress?: (event: ExportProgressEvent) => void,
): Promise<ExportRenderResult | null> => {
	const projectScope = getActiveProjectScope(env)
	if (!projectScope || !env.pageRuntime) {
		return null
	}

	const attrs = env.pageRuntime.readAttrs(projectScope, ['exportPlan']) as { exportPlan?: ExportPlan }
	const plan = attrs.exportPlan
	if (!plan || !plan.projectId) {
		return null
	}

	try {
		const result = await env.export.render({ plan, range, format: 'video-webm' }, onProgress)
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
deleteClipById(clipId: string): void {
dispatchClipActionById(env, clipId, 'removeSelf')
},
deleteSelectedClip(): void {
dispatchRoot(env, 'deleteSelectedClip')
},
splitSelectedClip(): void {
dispatchRoot(env, 'splitSelectedClip')
},
splitClipByIdAt(clipId: string, time: number): void {
dispatchClipActionById(env, clipId, 'splitSelfAt', { time: roundToHundredths(time) })
},
removeEffectFromClip(clipId: string, effectId: string): void {
dispatchClipActionById(env, clipId, 'removeEffect', { effectId })
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
moveClipById(clipId: string, delta: number): void {
dispatchClipActionById(env, clipId, 'moveBy', { delta })
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