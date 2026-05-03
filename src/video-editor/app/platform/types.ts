import type { ExportRenderer } from '../../render/exportRenderer'
import type { EditorAuthorityClient } from '../../worker/authorityClient'
import type { AuthorityResourceBindings } from '../../worker/createAuthorityClient'

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
