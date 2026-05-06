import type { ResourceKind } from '../render/registryTypes'
import type { ResourceTransferManager } from '../media/resourceTransferManager'
import type { ExportProgressEvent, ExportRenderer, ExportRenderRequest, ExportRenderResult } from '../render/exportRenderer'
import type { VideoEditorHarnessPlatform } from './platform'
import type { DispatchRuntimeTaskOptions, DispatchRuntimeTaskPayload, RuntimeTaskDescriptor } from './runtimeTaskFacade'
import type { PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'

/**
 * Phase 1 hard rewrite: registry-based ports removed.
 * EditorActionEnvironment now uses pageRuntime for all DKT dispatch.
 */

export interface EditorMediaPort {
	getFileKind(file: File): Extract<ResourceKind, 'video' | 'audio' | 'image'> | null
	createObjectUrl(blob: Blob): string | null
	revokeObjectUrl(url: string): void
	getImportedResourceDuration(url: string, kind: Extract<ResourceKind, 'video' | 'audio' | 'image'>): Promise<number>
}

export interface EditorExportPort {
	renderer: ExportRenderer
	render(request: ExportRenderRequest, onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult>
}

export interface EditorResourceTransferPort {
	manager: ResourceTransferManager
	getPeerId(): string | null
	resolveResourceUrl(resourceId: string, fallbackUrl: string): string
	requestPlayheadWindow(resourceId: string, time: number): void
	notePreviewError(resourceId: string): void
}

export interface EditorLifecyclePort {
	isDestroyed(): boolean
	setTimeout(handler: () => void, timeoutMs: number): ReturnType<typeof setTimeout>
	clearTimeout(timerId: ReturnType<typeof setTimeout>): void
	registerObjectUrl(url: string, bucket: 'import' | 'export'): void
}

export interface EditorRuntimeTaskPort {
	dispatchTask(
		fxName: `$fx_${string}`,
		payload?: DispatchRuntimeTaskPayload,
		options?: DispatchRuntimeTaskOptions,
	): RuntimeTaskDescriptor
	consumeRuntimeRef(runtimeRefId: string): unknown
	deleteRuntimeRef(runtimeRefId: string): void
	completeTask(task: Pick<RuntimeTaskDescriptor, 'taskId' | 'intentKey'>): void
}

/** DKT dispatch port used by harness actions. */
export interface EditorDktScopePort {
	getRootScope(): ReactSyncScopeHandle | null
	dispatch(actionName: string, payload?: unknown, scope?: ReactSyncScopeHandle | null): void
}

export interface EditorActionEnvironment {
	pageRuntime: PageSyncRuntime | null
	dkt: EditorDktScopePort | null
	media: EditorMediaPort
	export: EditorExportPort
	transfers: EditorResourceTransferPort
	lifecycle: EditorLifecyclePort
	tasks: EditorRuntimeTaskPort
	platform: VideoEditorHarnessPlatform
}
