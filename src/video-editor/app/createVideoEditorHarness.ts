import { createMiniCutPageSyncRuntime } from '../dkt/runtime/createMiniCutPageSyncRuntime'
import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import type { ExportRenderer } from '../render/exportRenderer'
import type { ResourceAttrs } from '../render/registryTypes'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import { createResourceTransferManager } from '../media/resourceTransferManager'
import { createRuntimeTaskFacade } from './runtimeTaskFacade'
import { parseExportRequest } from './exportRequestState'
import { PROJECT_RENDER_EXPORT_FX } from '../models/Project/effects'
import {
	AUTH_EXT_CHANNEL,
	AUTH_EXT_EVENT,
	createAuthorityExtensionBus,
} from './authorityExtensionBus'
import { executeRenderExportTask } from './renderExportTaskExecutor'
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from './platform'
import { createEditorHarnessAdapter } from './editorHarnessAdapter'
import type { EditorActionEnvironment, EditorDktScopePort } from './editorActionEnvironment'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'

type DktResourceAttrs = ResourceAttrs & { sourceResourceId: string }

const EMPTY_CLEANUP = () => {}

const debugExport = (message: string, details?: unknown) => {
	if ((globalThis as { __MINICUT_EXPORT_DEBUG__?: unknown }).__MINICUT_EXPORT_DEBUG__ !== true) {
		return
	}
	console.info('[minicut:export:harness]', message, details)
}

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

const createMiniCutPageRuntime = (authorityClient: EditorAuthorityClient) => {
	if (typeof authorityClient.openDktTransport !== 'function') {
		return null
	}

	return createMiniCutPageSyncRuntime({ transport: authorityClient.openDktTransport() })
}

const readResourceAttrs = (pageRuntime: NonNullable<ReturnType<typeof createMiniCutPageRuntime>>, scope: ReactSyncScopeHandle): DktResourceAttrs | null => {
	const attrs = pageRuntime.readAttrs(scope, [
		'sourceResourceId',
		'name',
		'kind',
		'url',
		'mime',
		'duration',
		'width',
		'height',
		'size',
		'source',
		'status',
		'data',
	]) as Record<string, unknown>

	if (typeof attrs.sourceResourceId !== 'string' || !attrs.sourceResourceId) {
		return null
	}

	return {
		sourceResourceId: attrs.sourceResourceId,
		name: typeof attrs.name === 'string' ? attrs.name : attrs.sourceResourceId,
		kind: attrs.kind === 'audio' || attrs.kind === 'image' || attrs.kind === 'text' ? attrs.kind : 'video',
		url: typeof attrs.url === 'string' ? attrs.url : '',
		mime: typeof attrs.mime === 'string' ? attrs.mime : 'application/octet-stream',
		duration: typeof attrs.duration === 'number' ? attrs.duration : 0,
		width: typeof attrs.width === 'number' ? attrs.width : undefined,
		height: typeof attrs.height === 'number' ? attrs.height : undefined,
		size: typeof attrs.size === 'number' ? attrs.size : undefined,
		source: attrs.source && typeof attrs.source === 'object' ? attrs.source as Record<string, unknown> : undefined,
		status: typeof attrs.status === 'string' ? attrs.status : undefined,
		data: attrs.data && typeof attrs.data === 'object' ? attrs.data as Record<string, unknown> : undefined,
	}
}

interface CreateVideoEditorHarnessOptions {
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

/**
 * Phase 1 hard rewrite: DKT-only harness.
 * No legacy registry stores, state mirrors, registry reads, or source-id lookups.
 * Only DKT page runtime, platform boundary, and task ports.
 */
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
	
	const exportRenderer = options.exportRenderer ?? platform.createExportRenderer()
	const pageRuntime = createMiniCutPageRuntime(authorityClient)
	const runtimeTasks = createRuntimeTaskFacade()
	const extensionBus = createAuthorityExtensionBus()
	
	let isDestroyed = false
	const importedObjectUrls = new Set<string>()
	const exportObjectUrls = new Set<string>()

	const subscribeToResourceScopes = (): (() => void) => {
		if (!pageRuntime) {
			return EMPTY_CLEANUP
		}

		let disposeProjectResources = EMPTY_CLEANUP

		const syncActiveProjectResources = () => {
			const rootScope = pageRuntime.getRootScope()
			if (!rootScope) {
				resourceTransferManager.syncResources([])
				return
			}

			const activeProjectScope = pageRuntime.readOne(rootScope, 'activeProject')
			if (!activeProjectScope) {
				resourceTransferManager.syncResources([])
				return
			}

			disposeProjectResources()

			const syncResources = () => {
				const latestRootScope = pageRuntime.getRootScope()
				if (!latestRootScope) {
					resourceTransferManager.syncResources([])
					return
				}

				const latestActiveProjectScope = pageRuntime.readOne(latestRootScope, 'activeProject')
				if (!latestActiveProjectScope) {
					resourceTransferManager.syncResources([])
					return
				}

				const resourceScopes = pageRuntime.readMany(latestActiveProjectScope, 'resources')
				const resources = resourceScopes
					.map((resourceScope) => {
						const attrs = readResourceAttrs(pageRuntime, resourceScope)
						if (!attrs || typeof attrs.sourceResourceId !== 'string') {
							return null
						}
						return { resourceId: attrs.sourceResourceId, attrs }
					})
					.filter((entry): entry is { resourceId: string; attrs: DktResourceAttrs } => entry !== null)

				resourceTransferManager.syncResources(resources)
			}

			// Event-driven: subscribe to resources rel changes
			const unsubscribe = pageRuntime.subscribeMany(activeProjectScope, 'resources', syncResources)
			disposeProjectResources = () => {
				unsubscribe()
			}
			// Sync current state immediately
			syncResources()
		}

		// Subscribe to root scope changes (activeProject rel change triggers resync)
		const disposeActiveProject = pageRuntime.subscribeRootScope(() => {
			syncActiveProjectResources()
		})
		
		// Initialize immediately with current state
		syncActiveProjectResources()

		return () => {
			disposeProjectResources()
			disposeActiveProject()
		}
	}

	const unsubscribe = subscribeToResourceScopes()

	const subscribeToDownloadBridge = (): (() => void) => extensionBus.subscribe(
		AUTH_EXT_CHANNEL.EXPORT_DOWNLOAD,
		(event) => {
			if (event.event !== AUTH_EXT_EVENT.EXPORT_READY) {
				return
			}
			const payload = event.payload as { downloadUrl?: unknown; fileName?: unknown; targetPeerId?: unknown } | null
			if (!payload || typeof payload !== 'object') {
				return
			}
			if (typeof document === 'undefined') {
				return
			}
			const downloadUrl = typeof payload.downloadUrl === 'string' ? payload.downloadUrl : null
			if (!downloadUrl) {
				return
			}
			const localPeerId = env.transfers.getPeerId()
			const targetPeerId = typeof payload.targetPeerId === 'string' ? payload.targetPeerId : null
			if (targetPeerId !== null && localPeerId !== null && targetPeerId !== localPeerId) {
				return
			}
			const fileName = typeof payload.fileName === 'string' && payload.fileName
				? payload.fileName
				: 'export.webm'
			const anchor = document.createElement('a')
			anchor.href = downloadUrl
			anchor.download = fileName
			document.body.appendChild(anchor)
			anchor.click()
			document.body.removeChild(anchor)
		},
	)

	const dktPort: EditorDktScopePort | null = pageRuntime
		? {
			dispatch: (actionName, payload, scope) => pageRuntime.dispatch(actionName, payload, scope ?? null),
		}
		: null

	const env: EditorActionEnvironment = {
		pageRuntime,
		dkt: dktPort,
		media: {
			getFileKind,
			createObjectUrl: (blob) => platform.createObjectUrl(blob),
			revokeObjectUrl: (url) => platform.revokeObjectUrl(url),
			getImportedResourceDuration: (url, kind) => platform.getImportedResourceDuration(url, kind),
		},
		export: {
			renderer: exportRenderer,
			cachedResults: new Map<string, { downloadUrl: string; blob: Blob; timestamp: number }>(),
		},
		transfers: {
			manager: resourceTransferManager,
			getPeerId: () => {
				const peerId = (authorityClientRef as Partial<{ peerId: unknown }> | null)?.peerId
				return typeof peerId === 'string' ? peerId : null
			},
			resolveResourceUrl: (resourceId, fallbackUrl) => resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl),
			requestPlayheadWindow: (resourceId, time) => resourceTransferManager.requestPlayheadWindow(resourceId, time),
			notePreviewError: (resourceId) => resourceTransferManager.notePreviewError(resourceId),
		},
		lifecycle: {
			isDestroyed: () => isDestroyed,
			setTimeout: (handler, ms) => platform.setTimeout(handler, ms),
			clearTimeout: (id) => platform.clearTimeout(id),
			registerObjectUrl: (url, bucket) => {
				if (bucket === 'export') {
					exportObjectUrls.add(url)
				} else {
					importedObjectUrls.add(url)
				}
			},
		},
		tasks: runtimeTasks,
		platform,
		resourceChunkSize,
	}

	const actions = createEditorHarnessAdapter(env)

	const subscribeToExportRequests = (): (() => void) => {
		if (!pageRuntime || !dktPort) {
			return EMPTY_CLEANUP
		}

		const unlistenExportRequest = pageRuntime.subscribeExportRequests?.((payload) => {
			const request = parseExportRequest(payload)
			if (!request) {
				debugExport('channel export request ignored: invalid payload', payload)
				return
			}
			debugExport('channel export request observed', { id: request.id })
			const intentKey = request.range.type === 'clip'
				? `${PROJECT_RENDER_EXPORT_FX}:clip:${request.range.clipId}`
				: `${PROJECT_RENDER_EXPORT_FX}:project`
			const task = runtimeTasks.dispatchTask(PROJECT_RENDER_EXPORT_FX, {
				data: request,
			}, {
				queuePolicy: 'replace-last',
				intentKey,
			})
			if (task.dropped) {
				return
			}
			void executeRenderExportTask({
				task,
				env,
				extensionBus,
			})
		}) ?? EMPTY_CLEANUP

		return () => {
			unlistenExportRequest()
		}
	}

	const unsubscribeDownloadBridge = subscribeToDownloadBridge()
	const unsubscribeExportRequests = subscribeToExportRequests()

	return {
		// Only essential public API
		worker: authorityClient,
		pageRuntime,
		actions,
		resourceTransfers$: resourceTransferManager.transfers$,
		resourceChunkSize,
		media: env.media,
		transfers: env.transfers,
		lifecycle: env.lifecycle,
		// TESTING AND DEBUG ONLY — queue snapshot for fx task diagnostics.
		debugDumpRuntimeTasksTesting: () => runtimeTasks.debugDumpTasksTesting(),
		
		resolveResourceUrl(resourceId: string, fallbackUrl: string): string {
			return resourceTransferManager.resolveResourceUrl(resourceId, fallbackUrl)
		},
		
		requestResourcePlayheadWindow(resourceId: string, time: number): void {
			resourceTransferManager.requestPlayheadWindow(resourceId, time)
		},
		
		noteResourcePreviewError(resourceId: string): void {
			resourceTransferManager.notePreviewError(resourceId)
		},
		
		destroy(): void {
			isDestroyed = true
			runtimeTasks.clear()
			unsubscribe()
			unsubscribeDownloadBridge()
			unsubscribeExportRequests()
			for (const url of importedObjectUrls) {
				platform.revokeObjectUrl(url)
			}
			for (const url of exportObjectUrls) {
				platform.revokeObjectUrl(url)
			}
			extensionBus.clear()
			env.export.cachedResults.clear()
			resourceTransferManager.destroy()
			pageRuntime?.destroy()
			authorityClient.destroy?.()
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
