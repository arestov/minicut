import { observable, type Observable } from '@legendapp/state'
import { createPlaybackDuration$ } from '../read-model/previewReadModel'
import { applyPatchEnvelope, applySnapshot, createProjectsStore } from '../legend/projectStore'
import { createSessionStore } from '../legend/sessionStore'
import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import type {
	Command,
	DispatchResult,
	EditorSessionState,
	HistoryState,
	ProjectRegistry,
} from '../domain/types'
import { CMD } from '../domain/types'
import { createResourceTransferManager } from '../media/resourceTransferManager'
import type { ExportRenderer } from '../render/exportRenderer'
import { createLegendEditorRenderRuntime } from '../render-sync/createLegendEditorRenderRuntime'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import { createLegendActionRuntime } from './createLegendActionRuntime'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import { createRuntimeTaskFacade } from './runtimeTaskFacade'
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from './platform'

const SNAPSHOT_BOOTSTRAP_RETRY_MS = 250

const getFileKind = (file: File): 'video' | 'audio' | 'image' | null => {
	if (file.type.startsWith('video/')) {
		return 'video'
	}
	if (file.type.startsWith('audio/')) {
		return 'audio'
	}
	if (file.type.startsWith('image/')) {
		return 'image'
	}

	const lowerName = file.name.toLowerCase()
	if (/\.(mp4|webm|mov|mkv)$/.test(lowerName)) {
		return 'video'
	}
	if (/\.(wav|mp3|ogg|m4a|aac)$/.test(lowerName)) {
		return 'audio'
	}
	if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lowerName)) {
		return 'image'
	}

	return null
}

const resolveActiveProjectId = (
	registry: ProjectRegistry,
	session: Pick<EditorSessionState, 'activeProjectId'>,
): string | null => {
	const sessionProjectId = session.activeProjectId
	if (sessionProjectId && registry.projects[sessionProjectId]) {
		return sessionProjectId
	}

	const registryProjectId = registry.activeProjectId
	if (registryProjectId && registry.projects[registryProjectId]) {
		return registryProjectId
	}

	return Object.keys(registry.projects)[0] ?? null
}

interface CreateVideoEditorHarnessOptions {
	autoCreateInitialProject?: boolean
	exportRenderer?: ExportRenderer
	platform?: VideoEditorHarnessPlatform
	mediaTransferOptions?: {
		chunkSize?: number
		chunkSendDelayMs?: number
		headBytes?: number
		tailBytes?: number
		playheadWindowSeconds?: number
	}
}

export const createVideoEditorHarness = (
	authority?: EditorAuthorityClient,
	options: CreateVideoEditorHarnessOptions = {},
) => {
	let authorityClientRef: EditorAuthorityClient | null = null
	const resourceChunkSize = options.mediaTransferOptions?.chunkSize ?? DEFAULT_RESOURCE_CHUNK_SIZE
	const resourceTransferManager = createResourceTransferManager({
		getRole: () => {
			const role = (authorityClientRef as Partial<{ role: unknown }> | null)?.role
			return role === 'server' || role === 'client' || role === 'undecided' ? role : null
		},
		getPeerId: () => {
			const peerId = (authorityClientRef as Partial<{ peerId: unknown }> | null)?.peerId
			return typeof peerId === 'string' ? peerId : null
		},
		chunkSize: resourceChunkSize,
		chunkSendDelayMs: options.mediaTransferOptions?.chunkSendDelayMs,
		headBytes: options.mediaTransferOptions?.headBytes,
		tailBytes: options.mediaTransferOptions?.tailBytes,
		playheadWindowSeconds: options.mediaTransferOptions?.playheadWindowSeconds,
	})
	const platform = options.platform
		?? createBrowserHarnessPlatform({
			exportRenderer: options.exportRenderer,
		})
	const authorityClient = authority ?? platform.createAuthorityClient({
		onClientResourceTransport: (transport) => {
			resourceTransferManager.attachClientTransport(transport)
		},
		onServerResourceTransport: (remotePeerId, transport) => {
			resourceTransferManager.attachServerTransport(remotePeerId, transport)
		},
		onResourcePeerDisconnected: (remotePeerId) => {
			resourceTransferManager.detachPeerTransport(remotePeerId)
		},
	})
	authorityClientRef = authorityClient
	const autoCreateInitialProject = options.autoCreateInitialProject ?? true
	const exportRenderer = options.exportRenderer ?? platform.createExportRenderer()
	const projects$ = createProjectsStore()
	const session$ = createSessionStore()
	const playbackDuration$ = createPlaybackDuration$(projects$, session$)
	const history$ = observable<HistoryState>({ canUndo: false, canRedo: false })
	const importedObjectUrls = new Set<string>()
	const exportObjectUrls = new Set<string>()
	let initialBootstrapChecked = false
	let projectBootstrapInFlight = false
	let isDestroyed = false
	let snapshotBootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null
	let initialProjectRetryTimer: ReturnType<typeof setTimeout> | null = null
	const runtimeTasks = createRuntimeTaskFacade()
	type MiniCutDktRuntime = ReturnType<typeof import('../dkt/runtime/createMiniCutDktRuntime')['createMiniCutDktRuntime']>
	let dktRuntime: MiniCutDktRuntime | null = null
	const getDktRuntime = async (): Promise<MiniCutDktRuntime> => {
		if (!dktRuntime) {
			const { createMiniCutDktRuntime } = await import('../dkt/runtime/createMiniCutDktRuntime')
			dktRuntime = createMiniCutDktRuntime({ enabled: true })
		}

		return dktRuntime
	}

	const getAuthorityRole = (): 'server' | 'client' | 'undecided' | null => {
		const role = (authorityClient as Partial<{ role: unknown }>).role
		if (role === 'server' || role === 'client' || role === 'undecided') {
			return role
		}

		return null
	}

	const clearInitialProjectRetry = (): void => {
		if (initialProjectRetryTimer) {
			platform.clearTimeout(initialProjectRetryTimer)
			initialProjectRetryTimer = null
		}
	}

	const scheduleInitialProjectRetry = (): void => {
		if (isDestroyed || initialProjectRetryTimer) {
			return
		}

		initialProjectRetryTimer = platform.setTimeout(() => {
			initialProjectRetryTimer = null
			ensureInitialProject()
		}, SNAPSHOT_BOOTSTRAP_RETRY_MS)
	}

	const syncActiveProjectSelection = (): void => {
		const registry = projects$.get()
		const resolvedProjectId = resolveActiveProjectId(registry, session$.get())
		if (!resolvedProjectId) {
			return
		}

		const registryActiveProjectId = projects$.activeProjectId.get()
		if (!registryActiveProjectId || !registry.projects[registryActiveProjectId]) {
			projects$.activeProjectId.set(resolvedProjectId)
		}

		if (session$.activeProjectId.get() !== resolvedProjectId) {
			session$.activeProjectId.set(resolvedProjectId)
		}
	}

	const syncHistoryState = (): void => {
		Promise.resolve(authorityClient.getHistoryState()).then((state) => {
			if (!isDestroyed) {
				history$.set(state)
			}
		})
	}

	const ensureInitialProject = (): void => {
		if (!autoCreateInitialProject) {
			return
		}
		if (initialBootstrapChecked || isDestroyed) {
			return
		}

		const authorityRole = getAuthorityRole()
		if (authorityRole === 'client') {
			initialBootstrapChecked = true
			clearInitialProjectRetry()
			return
		}

		if (authorityRole === 'undecided') {
			scheduleInitialProjectRetry()
			return
		}

		initialBootstrapChecked = true
		clearInitialProjectRetry()

		const registry = projects$.get()
		if (Object.keys(registry.projects).length > 0 || projectBootstrapInFlight) {
			syncActiveProjectSelection()
			return
		}

		projectBootstrapInFlight = true
		Promise.resolve(authorityClient.dispatch({ c: CMD.PROJECT_CREATE, p: {} })).then((result) => {
			if (isDestroyed) {
				return
			}

			const projectId = String(result.createdIds?.projectId)
			session$.activeProjectId.set(projectId)
			session$.selectedEntityId.set(null)
			session$.cursor.set(0)
		}).finally(() => {
			projectBootstrapInFlight = false
			syncHistoryState()
		})
	}

	const bootstrapSnapshot = (): void => {
		Promise.resolve(authorityClient.getSnapshot()).then((snapshot) => {
			if (isDestroyed) {
				return
			}

			if (snapshotBootstrapRetryTimer) {
				platform.clearTimeout(snapshotBootstrapRetryTimer)
				snapshotBootstrapRetryTimer = null
			}

			applySnapshot(projects$, snapshot)
			resourceTransferManager.syncRegistry(snapshot)
			syncActiveProjectSelection()
			syncHistoryState()
			ensureInitialProject()
		}).catch(() => {
			if (isDestroyed) {
				return
			}

			snapshotBootstrapRetryTimer = platform.setTimeout(() => {
				snapshotBootstrapRetryTimer = null
				bootstrapSnapshot()
			}, SNAPSHOT_BOOTSTRAP_RETRY_MS)
		})
	}

	bootstrapSnapshot()

	const unsubscribe = authorityClient.subscribe((envelope) => {
		applyPatchEnvelope(projects$, envelope)
		resourceTransferManager.syncRegistry(projects$.get())
		syncActiveProjectSelection()
		syncHistoryState()
	})

	const dispatch = (command: Command): Promise<DispatchResult> =>
		Promise.resolve(authorityClient.dispatch(command)).finally(syncHistoryState)

	const actionEnvironment: EditorActionEnvironment = {
		stores: {
			projects$,
			history$,
			getRegistry: () => projects$.get(),
			applySnapshot: (snapshot) => applySnapshot(projects$, snapshot),
			applyPatchEnvelope: (envelope) => applyPatchEnvelope(projects$, envelope),
		},
		authority: {
			client: authorityClient,
			dispatch,
			undo: () => authorityClient.undo(),
			redo: () => authorityClient.redo(),
			getSnapshot: () => authorityClient.getSnapshot(),
			getHistoryState: () => authorityClient.getHistoryState(),
			subscribe: (listener) => authorityClient.subscribe(listener),
			syncHistoryState,
		},
		session: {
			session$,
			get: () => session$.get(),
			setActiveProject: (projectId) => session$.activeProjectId.set(projectId),
			selectEntity: (entityId) => session$.selectedEntityId.set(entityId),
			setCursor: (value) => session$.cursor.set(value),
			setPlaying: (value) => session$.isPlaying.set(value),
			setTimelineZoom: (value) => session$.timelineZoom.set(value),
			setActiveInspectorTab: (tab) => session$.activeInspectorTab.set(tab),
		},
		media: {
			getFileKind,
			createObjectUrl: (blob) => platform.createObjectUrl(blob),
			revokeObjectUrl: (url) => platform.revokeObjectUrl(url),
			getImportedResourceDuration: (url, kind) => platform.getImportedResourceDuration(url, kind),
		},
		export: {
			renderer: exportRenderer,
			render: (request, onProgress) => onProgress
				? exportRenderer.render(request, onProgress)
				: exportRenderer.render(request),
		},
		transfers: {
			manager: resourceTransferManager,
			syncRegistry: (registry) => resourceTransferManager.syncRegistry(registry),
			resolveResourceUrl: (resourceId, fallbackUrl) => resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl),
			requestPlayheadWindow: (resourceId, time) => resourceTransferManager.requestPlayheadWindow(resourceId, time),
			notePreviewError: (resourceId) => resourceTransferManager.notePreviewError(resourceId),
		},
		lifecycle: {
			isDestroyed: () => isDestroyed,
			setTimeout: (handler, timeoutMs) => platform.setTimeout(handler, timeoutMs),
			clearTimeout: (timerId) => platform.clearTimeout(timerId),
			registerObjectUrl: (url, bucket) => {
				if (bucket === 'import') {
					importedObjectUrls.add(url)
					return
				}

				exportObjectUrls.add(url)
			},
		},
		tasks: {
			dispatchTask: (fxName, payload, taskOptions) => runtimeTasks.dispatchTask(fxName, payload, taskOptions),
			consumeRuntimeRef: (runtimeRefId) => runtimeTasks.consumeRuntimeRef(runtimeRefId),
			deleteRuntimeRef: (runtimeRefId) => runtimeTasks.deleteRuntimeRef(runtimeRefId),
			completeTask: (task) => runtimeTasks.completeTask(task),
		},
		dkt: {
			dispatchSessionAction: async (actionName, payload) => {
				const runtime = await getDktRuntime()
				await runtime.dispatchSessionAction(actionName, payload)
			},
			dispatchClipAction: async (clip, actionName, payload) => {
				const runtime = await getDktRuntime()
				await runtime.dispatchClipAction(clip, actionName, payload)
			},
		},
		platform,
	}

	const actions = createLegendActionRuntime(actionEnvironment, {
		playbackDuration$,
		resourceChunkSize,
	})
	const renderRuntime = createLegendEditorRenderRuntime({
		projects$,
		session$,
		history$,
		resourceTransfers$: resourceTransferManager.transfers$,
		actions,
	})

	return {
		worker: authorityClient,
		projects$,
		session$,
		history$,
		renderRuntime,
		resourceTransfers$: resourceTransferManager.transfers$,
		actionEnvironment,
		resolveResourceUrl(resourceId: string, fallbackUrl: string): string {
			return resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl)
		},
		requestResourcePlayheadWindow(resourceId: string, time: number): void {
			resourceTransferManager.requestPlayheadWindow(resourceId, time)
		},
		noteResourcePreviewError(resourceId: string): void {
			resourceTransferManager.notePreviewError(resourceId)
		},
		actions,
		destroy(): void {
			isDestroyed = true
			runtimeTasks.clear()
			clearInitialProjectRetry()
			if (snapshotBootstrapRetryTimer) {
				platform.clearTimeout(snapshotBootstrapRetryTimer)
				snapshotBootstrapRetryTimer = null
			}
			unsubscribe()
			for (const url of importedObjectUrls) {
				platform.revokeObjectUrl(url)
			}
			resourceTransferManager.destroy()
			authorityClient.destroy?.()
			for (const url of exportObjectUrls) {
				platform.revokeObjectUrl(url)
			}
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
