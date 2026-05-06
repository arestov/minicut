import { createMiniCutPageSyncRuntime } from '../dkt/runtime/createMiniCutPageSyncRuntime'
import { DEFAULT_RESOURCE_CHUNK_SIZE } from '../domain/resourceData'
import type { ExportRenderer } from '../render/exportRenderer'
import { createDktPageEditorRenderRuntime } from '../render-sync/createDktPageEditorRenderRuntime'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import { createResourceTransferManager } from '../media/resourceTransferManager'
import { createRuntimeTaskFacade } from './runtimeTaskFacade'
import {
	createBrowserHarnessPlatform,
	type VideoEditorHarnessPlatform,
} from './platform'
import { createDktActionRuntime } from './createDktActionRuntime'
import type { EditorActionEnvironment, EditorDktScopePort } from './editorActionEnvironment'

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
 * No ProjectRegistry, projects$, session$, registry reads, or source-id lookups.
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

	// Cleanup: no registry subscription, no projects$/session$ stores
	const unsubscribe = EMPTY_CLEANUP

	const dktPort: EditorDktScopePort | null = pageRuntime
		? {
			getRootScope: () => pageRuntime.getRootScope(),
			dispatch: (actionName, payload, scope) => pageRuntime.dispatch(actionName, payload, scope ?? null),
			readAttrs: (scope, attrNames) => pageRuntime.readAttrs(scope, attrNames),
			readOne: (scope, relName) => pageRuntime.readOne(scope, relName),
			readMany: (scope, relName) => pageRuntime.readMany(scope, relName),
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

	const actions = createDktActionRuntime(env, { resourceChunkSize })

	const renderRuntime = createDktPageEditorRenderRuntime({
		pageRuntime,
		actions,
	})

	return {
		// Only essential public API
		worker: authorityClient,
		pageRuntime,
		renderRuntime,
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
