import {
	createManifestExportRenderer,
	type ExportRenderer,
} from '../../render/exportRenderer'
import { createFallbackAuthorityClient } from '../../worker/fallbackAuthorityClient'
import type { VideoEditorHarnessPlatform } from './types'

const fallbackMediaDuration = 6
const imageDuration = 1

export interface CreateNodeHarnessPlatformOptions {
	exportRenderer?: ExportRenderer
}

export const createNodeHarnessPlatform = (
	options: CreateNodeHarnessPlatformOptions = {},
): VideoEditorHarnessPlatform => ({
	createAuthorityClient: () => createFallbackAuthorityClient(),
	createExportRenderer: () => options.exportRenderer ?? createManifestExportRenderer(),
	async getImportedResourceDuration(_url, kind) {
		if (kind === 'image') {
			return imageDuration
		}

		return fallbackMediaDuration
	},
	createObjectUrl() {
		return null
	},
	revokeObjectUrl() {
		// no-op in headless node runtime
	},
	setTimeout(handler, timeoutMs) {
		return setTimeout(handler, timeoutMs)
	},
	clearTimeout(timerId) {
		clearTimeout(timerId)
	},
})
