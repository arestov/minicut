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

	const renderRuntime = createDktPageEditorRenderRuntime({
		pageRuntime,
	})

	return {
		// Only essential public API
		worker: authorityClient,
		pageRuntime,
		renderRuntime,
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
