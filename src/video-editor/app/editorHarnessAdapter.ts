import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateEditorHarnessAdapterOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'

let projectSequence = 0
let exportSequence = 0

const createSourceId = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`

const resolveNextProjectTitle = (env: EditorActionEnvironment): string => {
	if (!env.pageRuntime) {
		return 'Project 1'
	}

	const rootScope = getRootScope(env)
	if (!rootScope) {
		return 'Project 1'
	}

	const pioneerScope = env.pageRuntime.readOne(rootScope, 'pioneer')
	if (!pioneerScope) {
		return 'Project 1'
	}

	const projectScopes = env.pageRuntime.readMany(pioneerScope, 'project')
	let maxIndex = 0
	for (const projectScope of projectScopes) {
		const attrs = env.pageRuntime.readAttrs(projectScope, ['title']) as { title?: unknown }
		if (typeof attrs.title !== 'string') {
			continue
		}
		const match = attrs.title.match(/^Project\s+(\d+)$/i)
		if (!match) {
			continue
		}
		const value = Number.parseInt(match[1], 10)
		if (Number.isFinite(value) && value > maxIndex) {
			maxIndex = value
		}
	}

	return `Project ${maxIndex + 1}`
}

const getRootScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => env.pageRuntime?.getRootScope() ?? null

const getRootNodeId = (env: EditorActionEnvironment): string | null => {
	const rootScope = getRootScope(env) as { _node_id?: unknown } | null
	return typeof rootScope?._node_id === 'string' ? rootScope._node_id : null
}

// Reading a direct rel on root - not traversal
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

// Reading a direct rel on root - not traversal
const dispatchRoot = (env: EditorActionEnvironment, actionName: string, payload?: unknown): void => {
env.dkt?.dispatch(actionName, payload, getRootScope(env))
}

const _resourceChunkSizeRef = new WeakMap<EditorActionEnvironment, number>()

const isTimelineEmpty = (env: EditorActionEnvironment, projectScope: ReactSyncScopeHandle): boolean => {
	if (!env.pageRuntime) {
		return true
	}
	const attrs = env.pageRuntime.readAttrs(projectScope, ['timelineDuration']) as { timelineDuration?: unknown }
	return typeof attrs.timelineDuration !== 'number' || attrs.timelineDuration <= 0
}

const importFilesDirectly = (env: EditorActionEnvironment, files: File[]): void => {
	const resourceChunkSize = _resourceChunkSizeRef.get(env) ?? 1024 * 1024
	void (async () => {
		const projectScope = getActiveProjectScope(env)
		if (!projectScope) {
			return
		}
		const ownerPeerId = env.transfers.getPeerId()
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
			let duration = 0
			try {
				duration = await env.media.getImportedResourceDuration(objectUrl, kind)
			} catch {
				// Continue import even if metadata probing fails on this engine/codec.
				duration = 0
			}
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
				source: {
					kind: 'local',
					ownerPeerId: typeof ownerPeerId === 'string' && ownerPeerId.length > 0 ? ownerPeerId : null,
				},
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
				ownerPeerId,
				sourceKind: 'local',
				fallbackUrl: objectUrl,
				name: file.name,
			})
		}
	})().catch(() => undefined)
}

export const createEditorHarnessAdapter = (
env: EditorActionEnvironment,
_options: CreateEditorHarnessAdapterOptions,
): VideoEditorHarnessActions => {
_resourceChunkSizeRef.set(env, _options.resourceChunkSize)

return ({
createProject(title?: string): void {
const resolvedTitle = typeof title === 'string' && title ? title : resolveNextProjectTitle(env)
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
selectEntity(entityId: string | null): void {
dispatchRoot(env, 'selectEntity', entityId)
},
setActiveInspectorTab(tab): void {
dispatchRoot(env, 'setActiveInspectorTab', tab)
},
deleteSelectedClip(): void {
dispatchRoot(env, 'deleteSelectedClip')
},
splitSelectedClip(): void {
dispatchRoot(env, 'splitSelectedClip')
},
requestSelectedClipExport(): void {
	dispatchRoot(env, 'requestSelectedClipExport', {
		id: `export:${Date.now().toString(36)}:${++exportSequence}`,
		initiatedBy: getRootNodeId(env),
	})
},
requestProjectExport(): void {
	dispatchRoot(env, 'requestProjectExport', {
		id: `export:${Date.now().toString(36)}:${++exportSequence}`,
		initiatedBy: getRootNodeId(env),
	})
},
getSessionRootNodeId(): string | null {
	return getRootNodeId(env)
},
getCachedExportUrl(exportId: string): string | null {
	const cached = env.export.cachedResults.get(exportId)
	return cached?.downloadUrl ?? null
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

