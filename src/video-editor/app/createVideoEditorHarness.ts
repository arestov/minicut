import { createMiniCutPageSyncRuntime } from '../dkt/runtime/createMiniCutPageSyncRuntime'
import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import type { ExportRenderer } from '../render/exportRenderer'
import type { ResourceAttrs } from '../render/registryTypes'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import { createResourceTransferManager } from '../media/resourceTransferManager'
import { createRuntimeTaskFacade } from './runtimeTaskFacade'
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from './platform'
import { createEditorHarnessAdapter } from './editorHarnessAdapter'
import type { EditorActionEnvironment, EditorDktScopePort } from './editorActionEnvironment'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'

type DktResourceAttrs = ResourceAttrs & { sourceResourceId: string }

const EMPTY_CLEANUP = () => {}

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
	
	let isDestroyed = false
	const importedObjectUrls = new Set<string>()
	const exportObjectUrls = new Set<string>()

	const subscribeToResourceScopes = (): (() => void) => {
		if (!pageRuntime) {
			return EMPTY_CLEANUP
		}

		let disposeProjectResources = EMPTY_CLEANUP
		let disposeActiveProject = EMPTY_CLEANUP
		let runtimeReadyTimeout: ReturnType<typeof window.setTimeout> | null = null
		let projectRefreshInterval: ReturnType<typeof window.setInterval> | null = null

		const clearProjectRefreshInterval = (): void => {
			if (projectRefreshInterval !== null) {
				window.clearInterval(projectRefreshInterval)
				projectRefreshInterval = null
			}
		}

		const syncActiveProjectResources = () => {
			const rootScope = pageRuntime.getRootScope()
			if (!rootScope) {
				resourceTransferManager.syncResources([])
				return
			}

			const pioneerScope = pageRuntime.readOne(rootScope, 'pioneer')
			const projectScopes = pioneerScope
				? pageRuntime.readMany(pioneerScope, 'project')
				: []
			const activeProjectScope = pageRuntime.readOne(rootScope, 'activeProject')
			const fallbackProjectScope = activeProjectScope ?? projectScopes[0] ?? null
			disposeProjectResources()
			clearProjectRefreshInterval()
			if (!fallbackProjectScope) {
				resourceTransferManager.syncResources([])
				if (runtimeReadyTimeout === null) {
					runtimeReadyTimeout = window.setTimeout(() => {
						runtimeReadyTimeout = null
						syncActiveProjectResources()
					}, 500)
				}
				return
			}

			const syncResources = () => {
				const latestRootScope = pageRuntime.getRootScope()
				if (!latestRootScope) {
					resourceTransferManager.syncResources([])
					return
				}

				const latestPioneerScope = pageRuntime.readOne(latestRootScope, 'pioneer')
				const latestProjectScopes = latestPioneerScope
					? pageRuntime.readMany(latestPioneerScope, 'project')
					: []
				const latestActiveProjectScope = pageRuntime.readOne(latestRootScope, 'activeProject')
				const scopesToRead = latestProjectScopes.length > 0
					? latestProjectScopes
					: latestActiveProjectScope
						? [latestActiveProjectScope]
						: [fallbackProjectScope]
				const resourceScopes = scopesToRead.flatMap((scope) => pageRuntime.readMany(scope, 'resources'))
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

			const scopesToWatch = projectScopes.length > 0 ? projectScopes : [fallbackProjectScope]
			const unsubscribers = scopesToWatch.map((scope) => pageRuntime.subscribeMany(scope, 'resources', syncResources))
			disposeProjectResources = () => {
				for (const unlisten of unsubscribers) {
					unlisten()
				}
			}
			projectRefreshInterval = window.setInterval(syncResources, 500)
			syncResources()
		}

		disposeActiveProject = pageRuntime.subscribeRootScope(() => {
			syncActiveProjectResources()
		})
		syncActiveProjectResources()

		return () => {
			if (runtimeReadyTimeout !== null) {
				window.clearTimeout(runtimeReadyTimeout)
				runtimeReadyTimeout = null
			}
			clearProjectRefreshInterval()
			disposeProjectResources()
			disposeActiveProject()
		}
	}

	const unsubscribe = subscribeToResourceScopes()

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
			render: (request, onProgress) => exportRenderer.render(request, onProgress),
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
	}

	const actions = createEditorHarnessAdapter(env, { resourceChunkSize })

	return {
		// Only essential public API
		worker: authorityClient,
		pageRuntime,
		actions,
		resourceTransfers$: resourceTransferManager.transfers$,
		
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
			for (const url of importedObjectUrls) {
				platform.revokeObjectUrl(url)
			}
			resourceTransferManager.destroy()
			pageRuntime?.destroy()
			authorityClient.destroy?.()
			for (const url of exportObjectUrls) {
				platform.revokeObjectUrl(url)
			}
		},
	}
}

export type VideoEditorHarness = ReturnType<typeof createVideoEditorHarness>
