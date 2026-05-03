import {
	createBrowserVideoExportRenderer,
	type ExportRenderer,
} from '../render/exportRenderer'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import {
	createAuthorityClient,
	type CreateAuthorityClientOptions,
} from '../worker/createAuthorityClient'

const fallbackMediaDuration = 6
const imageDuration = 1
const mediaMetadataTimeoutMs = 3000

export interface VideoEditorHarnessPlatform {
	createAuthorityClient(): EditorAuthorityClient
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
	createAuthorityClient: () => createAuthorityClient(options.authorityOptions),
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