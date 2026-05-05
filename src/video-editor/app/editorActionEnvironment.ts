import type { Observable } from '@legendapp/state'
import type { DispatchResult, EditorSessionState, PatchEnvelope, ProjectRegistry, ResourceKind, Command } from '../domain/types'
import type { ResourceTransferManager } from '../media/resourceTransferManager'
import type { ExportProgressEvent, ExportRenderer, ExportRenderRequest, ExportRenderResult } from '../render/exportRenderer'
import type { EditorAuthorityClient } from '../worker/authorityClient'
import type { VideoEditorHarnessPlatform } from './platform'
import type { DispatchRuntimeTaskOptions, DispatchRuntimeTaskPayload, RuntimeTaskDescriptor } from './runtimeTaskFacade'
import type { DktSessionActionName } from '../dkt/sessionActions'
import type { DktClipActionName } from '../dkt/clipActions'
import type { DktTimelineClipActionName } from '../dkt/timelineActions'
import type { DktTextActionName } from '../dkt/textActions'
import type { DktEffectActionName } from '../dkt/effectActions'
import type { MiniCutDktClipProxyInput, MiniCutDktEffectProxyInput, MiniCutDktTextProxyInput } from '../dkt/runtime/createMiniCutDktRuntime'

export interface EditorStorePort {
	projects$: Observable<ProjectRegistry>
	getRegistry(): ProjectRegistry
	applySnapshot(snapshot: ProjectRegistry): void
	applyPatchEnvelope(envelope: PatchEnvelope): void
}

export interface EditorAuthorityPort {
	client: EditorAuthorityClient
	dispatch(command: Command): Promise<DispatchResult>
	getSnapshot(): Promise<ProjectRegistry> | ProjectRegistry
	subscribe(listener: (envelope: PatchEnvelope) => void): () => void
}

export interface EditorSessionPort {
	session$: Observable<EditorSessionState>
	get(): EditorSessionState
	setActiveProject(projectId: string | null): void
	selectEntity(entityId: string | null): void
	setCursor(value: number): void
	setPlaying(value: boolean): void
	setTimelineZoom(value: number): void
	setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void
}

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
	syncRegistry(registry: ProjectRegistry): void
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

export interface EditorDktRuntimePort {
	dispatchSessionAction(actionName: DktSessionActionName, payload?: unknown): Promise<void> | void
	dispatchClipAction(clip: MiniCutDktClipProxyInput, actionName: DktClipActionName | DktTimelineClipActionName, payload?: unknown): Promise<void> | void
	dispatchTextAction(text: MiniCutDktTextProxyInput, actionName: DktTextActionName, payload?: unknown): Promise<void> | void
	dispatchEffectAction(effect: MiniCutDktEffectProxyInput, actionName: DktEffectActionName, payload?: unknown): Promise<void> | void
}

export interface EditorActionEnvironment {
	stores: EditorStorePort
	authority: EditorAuthorityPort
	session: EditorSessionPort
	media: EditorMediaPort
	export: EditorExportPort
	transfers: EditorResourceTransferPort
	lifecycle: EditorLifecyclePort
	tasks: EditorRuntimeTaskPort
	dkt?: EditorDktRuntimePort
	platform: VideoEditorHarnessPlatform
}
