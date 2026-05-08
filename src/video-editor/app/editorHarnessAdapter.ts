import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import { getAttrsShape } from '../../dkt-react-sync/shape/autoShapes'
import type { ExportProgressEvent, ExportRenderResult, ExportRange } from '../render/exportRenderer'
import type { ExportPlan } from '../render/renderPlan'
import type { EffectRenderInstruction } from '../render/colorPipeline'
import { mergeEffectFilters } from '../render/colorPipeline'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateEditorHarnessAdapterOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100
const asFiniteNumber = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback
let projectSequence = 0

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

const pushExportDebug = (event: string, details: unknown): void => {
	const payload = {
		event,
		timestamp: Date.now(),
		details,
	}
	try {
		const target = globalThis as typeof globalThis & { __MINICUT_EXPORT_DEBUG__?: unknown[] }
		if (!Array.isArray(target.__MINICUT_EXPORT_DEBUG__)) {
			target.__MINICUT_EXPORT_DEBUG__ = []
		}
		target.__MINICUT_EXPORT_DEBUG__.push(payload)
	} catch {
		// ignore debug storage failures
	}
}

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

const toResolvedScalar = (value: unknown, fallback: number): { value: number; keyframes?: unknown[] } => {
	if (value && typeof value === 'object' && 'value' in value) {
		const raw = value as { value?: unknown; keyframes?: unknown }
		return {
			value: asFiniteNumber(raw.value, fallback),
			...(Array.isArray(raw.keyframes) ? { keyframes: raw.keyframes } : {}),
		}
	}
	return { value: asFiniteNumber(value, fallback) }
}

const buildFallbackExportPlan = (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
	projectId: string,
	projectAttrs: { fps?: unknown; width?: unknown; height?: unknown; duration?: unknown },
): ExportPlan => {
	if (!env.pageRuntime) {
		return {
			projectId,
			fps: asFiniteNumber(projectAttrs.fps, 30),
			width: asFiniteNumber(projectAttrs.width, 1920),
			height: asFiniteNumber(projectAttrs.height, 1080),
			duration: asFiniteNumber(projectAttrs.duration, 0),
			clipSources: [],
		}
	}

	const resources = new Map<string, { name: string; kind: 'video' | 'audio' | 'image' | 'text'; url: string; mime: string }>()
	for (const resourceScope of env.pageRuntime.readMany(projectScope, 'resources')) {
		const attrs = env.pageRuntime.readAttrs(resourceScope, ['sourceResourceId', 'name', 'kind', 'url', 'mime']) as {
			sourceResourceId?: unknown
			name?: unknown
			kind?: unknown
			url?: unknown
			mime?: unknown
		}
		if (typeof attrs.sourceResourceId !== 'string' || !attrs.sourceResourceId) {
			continue
		}
		resources.set(attrs.sourceResourceId, {
			name: typeof attrs.name === 'string' ? attrs.name : 'Resource',
			kind: attrs.kind === 'audio' || attrs.kind === 'image' || attrs.kind === 'text' ? attrs.kind : 'video',
			url: typeof attrs.url === 'string' ? attrs.url : '',
			mime: typeof attrs.mime === 'string' ? attrs.mime : 'application/octet-stream',
		})
	}

	const clipSources: ExportPlan['clipSources'] = []
	const projectDuration = asFiniteNumber(projectAttrs.duration, 0)
	for (const trackScope of env.pageRuntime.readMany(projectScope, 'tracks')) {
		for (const clipScope of env.pageRuntime.readMany(trackScope, 'clips')) {
			const attrs = env.pageRuntime.readAttrs(clipScope, [
				'sourceClipId',
				'sourceResourceId',
				'name',
				'color',
				'mediaKind',
				'start',
				'in',
				'duration',
				'fadeIn',
				'fadeOut',
				'audio',
				'opacity',
				'transform',
			]) as {
				sourceClipId?: unknown
				sourceResourceId?: unknown
				name?: unknown
				color?: unknown
				mediaKind?: unknown
				start?: unknown
				in?: unknown
				duration?: unknown
				fadeIn?: unknown
				fadeOut?: unknown
				audio?: unknown
				opacity?: unknown
				transform?: unknown
			}
			if (typeof attrs.sourceClipId !== 'string' || !attrs.sourceClipId) {
				continue
			}

			const sourceResourceId = typeof attrs.sourceResourceId === 'string' ? attrs.sourceResourceId : attrs.sourceClipId
			const resource = resources.get(sourceResourceId)
			const start = Math.max(0, asFiniteNumber(attrs.start, 0))
			const clipDuration = Math.max(0, asFiniteNumber(attrs.duration, 0))
			const audio = attrs.audio && typeof attrs.audio === 'object'
				? attrs.audio as { gain?: unknown; pan?: unknown }
				: null
			const transform = attrs.transform && typeof attrs.transform === 'object'
				? attrs.transform as { x?: unknown; y?: unknown; scale?: unknown; rotation?: unknown }
				: null
			const effectScopes = env.pageRuntime.readMany(clipScope, 'effects')
			const effects: EffectRenderInstruction[] = effectScopes.map((effectScope) => {
				const effectAttrs = env.pageRuntime?.readAttrs(effectScope, ['kind', 'name', 'enabled', 'amount', 'params']) as {
					kind?: unknown
					name?: unknown
					enabled?: unknown
					amount?: unknown
					params?: unknown
				}
				return {
					kind: typeof effectAttrs?.kind === 'string' ? effectAttrs.kind as EffectRenderInstruction['kind'] : 'blur',
					name: typeof effectAttrs?.name === 'string' ? effectAttrs.name : 'Effect',
					enabled: effectAttrs?.enabled !== false,
					...(typeof effectAttrs?.amount === 'number' ? { amount: effectAttrs.amount } : {}),
					...(effectAttrs?.params && typeof effectAttrs.params === 'object' ? { params: effectAttrs.params as Record<string, unknown> } : {}),
				}
			})
			const mergedFilters = mergeEffectFilters(effects)

			clipSources.push({
				id: attrs.sourceClipId,
				resourceId: sourceResourceId,
				name: typeof attrs.name === 'string' ? attrs.name : (resource?.name ?? 'Clip'),
				color: typeof attrs.color === 'string' ? attrs.color : '#2563eb',
				resourceName: resource?.name ?? (typeof attrs.name === 'string' ? attrs.name : 'Resource'),
				resourceKind:
					attrs.mediaKind === 'audio' || attrs.mediaKind === 'image' || attrs.mediaKind === 'text'
						? attrs.mediaKind
						: (resource?.kind ?? 'video'),
				resourceUrl: resource?.url ?? '',
				mime: resource?.mime ?? 'application/octet-stream',
				inPoint: Math.max(0, asFiniteNumber(attrs.in, 0)),
				start,
				duration: clipDuration,
				fadeIn: Math.max(0, asFiniteNumber(attrs.fadeIn, 0)),
				fadeOut: Math.max(0, asFiniteNumber(attrs.fadeOut, 0)),
				opacity: toResolvedScalar(attrs.opacity, 1),
				transform: {
					x: toResolvedScalar(transform?.x, 0),
					y: toResolvedScalar(transform?.y, 0),
					scale: toResolvedScalar(transform?.scale, 1),
					rotation: toResolvedScalar(transform?.rotation, 0),
				},
				audio: {
					gain: Math.max(0, asFiniteNumber(audio?.gain, 1)),
					pan: asFiniteNumber(audio?.pan, 0),
				},
				filters: mergedFilters ? [mergedFilters] : [],
				effects,
				text: null,
			})
		}
	}

	return {
		projectId,
		fps: asFiniteNumber(projectAttrs.fps, 30),
		width: asFiniteNumber(projectAttrs.width, 1920),
		height: asFiniteNumber(projectAttrs.height, 1080),
		duration: projectDuration,
		clipSources,
	}
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

const waitForRuntimeReady = async (env: EditorActionEnvironment): Promise<void> => {
	if (!env.pageRuntime) {
		return
	}

	for (let attempt = 0; attempt < 80; attempt += 1) {
		if (env.pageRuntime.getSnapshot().ready) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
}

const waitForPeerId = async (env: EditorActionEnvironment): Promise<string | null> => {
	for (let attempt = 0; attempt < 80; attempt += 1) {
		const peerId = env.transfers.getPeerId()
		if (typeof peerId === 'string' && peerId.length > 0) {
			return peerId
		}
		await new Promise((resolve) => setTimeout(resolve, 25))
	}

	return env.transfers.getPeerId()
}

const importFilesDirectly = (env: EditorActionEnvironment, files: File[]): void => {
	const resourceChunkSize = _resourceChunkSizeRef.get(env) ?? 1024 * 1024
	void (async () => {
		await waitForRuntimeReady(env)
		const projectScope = await waitForActiveProjectScope(env)
		if (!projectScope) {
			return
		}
		const ownerPeerId = await waitForPeerId(env)
		// Give DKT transport time to attach after role/peer assignment to avoid dropped first sync writes.
		await new Promise((resolve) => setTimeout(resolve, 300))
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
				source: { kind: 'local', ownerPeerId },
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

const queueExport = async (
	env: EditorActionEnvironment,
	range: ExportRange,
	onProgress?: (event: ExportProgressEvent) => void,
): Promise<ExportRenderResult | null> => {
	const projectScope = getActiveProjectScope(env)
	const runtimeSnapshot = env.pageRuntime?.getSnapshot() ?? null
	if (!projectScope || !env.pageRuntime) {
		pushExportDebug('missing-project-scope', {
			range,
			runtimeSnapshot,
		})
		console.warn('[minicut:adapter-export] missing active project scope', {
			range,
			runtimeSnapshot,
		})
		return null
	}
	const exportAttrsShape = getAttrsShape(['exportPlan', 'sourceProjectId', 'fps', 'width', 'height', 'duration'])
	const releaseExportAttrsShape = exportAttrsShape
		? env.pageRuntime.mountShape(projectScope, exportAttrsShape)
		: () => undefined

	try {

	const computedAttrs = env.pageRuntime.readAttrs(projectScope, ['exportPlan']) as {
		exportPlan?: ExportPlan
	}
	const projectAttrs = env.pageRuntime.readAttrs(projectScope, ['sourceProjectId', 'fps', 'width', 'height', 'duration']) as {
		sourceProjectId?: unknown
		fps?: unknown
		width?: unknown
		height?: unknown
		duration?: unknown
	}
	const rootScope = getRootScope(env)
	const rootAttrs = rootScope
		? env.pageRuntime.readAttrs(rootScope, ['activeProjectId']) as {
			activeProjectId?: unknown
		}
		: null
	const fallbackProjectId =
		typeof projectAttrs.sourceProjectId === 'string' && projectAttrs.sourceProjectId
			? projectAttrs.sourceProjectId
			: (typeof rootAttrs?.activeProjectId === 'string' ? rootAttrs.activeProjectId : '')
	const computedPlan = computedAttrs.exportPlan
	const plan = computedPlan
		? {
			...computedPlan,
			projectId: computedPlan.projectId || fallbackProjectId,
		}
		: buildFallbackExportPlan(env, projectScope, fallbackProjectId, projectAttrs)
	if (!plan || !plan.projectId) {
		pushExportDebug('missing-export-plan', {
			range,
			sourceProjectId: projectAttrs.sourceProjectId ?? null,
			activeProjectId: rootAttrs?.activeProjectId ?? null,
			runtimeSnapshot,
			debugGraph: env.pageRuntime.debugDumpGraph(),
			debugMessages: env.pageRuntime.debugMessages().slice(-30),
		})
		console.warn('[minicut:adapter-export] missing export plan or projectId', {
			range,
			sourceProjectId: projectAttrs.sourceProjectId ?? null,
			activeProjectId: rootAttrs?.activeProjectId ?? null,
			runtimeSnapshot,
		})
		return null
	}

	try {
		pushExportDebug('render-start', {
			range,
			projectId: plan.projectId,
			runtimeSnapshot,
		})
		console.info('[minicut:adapter-export] render start', {
			range,
			projectId: plan.projectId,
		})
		const result = await env.export.render({ plan, range, format: 'video-webm' }, onProgress)
		const downloadUrl = env.media.createObjectUrl(result.blob)
		if (downloadUrl) {
			env.lifecycle.registerObjectUrl(downloadUrl, 'export')
			result.downloadUrl = downloadUrl
		}
		pushExportDebug('render-done', {
			range,
			projectId: plan.projectId,
			fileName: result.fileName,
			size: result.size,
			hasDownloadUrl: Boolean(result.downloadUrl),
			diagnostics: result.diagnostics ?? null,
		})
		console.info('[minicut:adapter-export] render done', {
			range,
			projectId: plan.projectId,
			fileName: result.fileName,
			hasDownloadUrl: Boolean(result.downloadUrl),
			diagnostics: result.diagnostics ?? null,
		})
		return result
	} catch (error) {
		pushExportDebug('render-failed', {
			range,
			projectId: plan.projectId,
			error: error instanceof Error ? error.stack || error.message : String(error),
			runtimeSnapshot,
			debugMessages: env.pageRuntime.debugMessages().slice(-30),
		})
		console.error('[minicut:adapter-export] render failed', {
			range,
			projectId: plan.projectId,
			error: error instanceof Error ? error.stack || error.message : String(error),
		})
		return null
	}
	} finally {
		releaseExportAttrsShape()
	}
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
addResourceToTimeline(resourceId: string): void {
	dispatchProject(env, 'addResourceToTimeline', { sourceResourceId: resourceId })
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

