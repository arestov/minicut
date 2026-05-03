import {
	createBrowserVideoExportRenderer,
	type ExportRenderer,
} from '../render/exportRenderer'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import {
	createAuthorityClient,
	type AuthorityResourceBindings,
	type CreateAuthorityClientOptions,
} from '../worker/createAuthorityClient'

const fallbackMediaDuration = 6
const imageDuration = 1
const mediaMetadataTimeoutMs = 3000

export interface VideoEditorHarnessPlatform {
	createAuthorityClient(bindings?: AuthorityResourceBindings): EditorAuthorityClient
	createExportRenderer(): ExportRenderer
	getImportedResourceDuration(
		url: string,
		kind: 'video' | 'audio' | 'image',
	): Promise<number>
	createObjectUrl(source: Blob): string | null
	revokeObjectUrl(url: string): void
	setTimeout(handler: () => void, timeoutMs: number): ReturnType<typeof setTimeout>
	clearTimeout(timerId: ReturnType<typeof setTimeout>): void
}

export interface CreateBrowserHarnessPlatformOptions {
	authorityOptions?: CreateAuthorityClientOptions
	exportRenderer?: ExportRenderer
}

const getMediaDuration = (
	url: string,
	kind: 'video' | 'audio',
	fallbackDuration = fallbackMediaDuration,
): Promise<number> => new Promise((resolve) => {
	if (typeof document === 'undefined') {
		resolve(fallbackDuration)
		return
	}

	const element = document.createElement(kind)
	let settled = false
	const timeoutId = setTimeout(() => finish(fallbackDuration), mediaMetadataTimeoutMs)

	const finish = (duration: number): void => {
		if (settled) {
			return
		}

		settled = true
		clearTimeout(timeoutId)
		element.removeAttribute('src')
		element.load()
		resolve(Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration)
	}

	element.preload = 'metadata'
	element.onloadedmetadata = () => finish(element.duration)
	element.onerror = () => finish(fallbackDuration)
	element.src = url
	element.load()
})

const getImportedResourceDuration = async (
	url: string,
	kind: 'video' | 'audio' | 'image',
): Promise<number> => {
	if (kind === 'image') {
		return imageDuration
	}

	return getMediaDuration(url, kind)
}

export const createBrowserHarnessPlatform = (
	options: CreateBrowserHarnessPlatformOptions = {},
): VideoEditorHarnessPlatform => ({
	createAuthorityClient(bindings) {
		const p2p = options.authorityOptions?.p2p
		if (!p2p) {
			return createAuthorityClient(options.authorityOptions)
		}

		return createAuthorityClient({
			...options.authorityOptions,
			p2p: {
				...p2p,
				onClientResourceTransport: (transport) => {
					bindings?.onClientResourceTransport?.(transport)
					p2p.onClientResourceTransport?.(transport)
				},
				onServerResourceTransport: (remotePeerId, transport) => {
					bindings?.onServerResourceTransport?.(remotePeerId, transport)
					p2p.onServerResourceTransport?.(remotePeerId, transport)
				},
				onResourcePeerDisconnected: (remotePeerId) => {
					bindings?.onResourcePeerDisconnected?.(remotePeerId)
					p2p.onResourcePeerDisconnected?.(remotePeerId)
				},
			},
		})
	},
	createExportRenderer: () => options.exportRenderer ?? createBrowserVideoExportRenderer(),
	getImportedResourceDuration,
	createObjectUrl(source) {
		if (typeof URL.createObjectURL !== 'function') {
			return null
		}

		return URL.createObjectURL(source)
	},
	revokeObjectUrl(url) {
		if (typeof URL.revokeObjectURL === 'function') {
			URL.revokeObjectURL(url)
		}
	},
	setTimeout(handler, timeoutMs) {
		return setTimeout(handler, timeoutMs)
	},
	clearTimeout(timerId) {
		clearTimeout(timerId)
	},
})