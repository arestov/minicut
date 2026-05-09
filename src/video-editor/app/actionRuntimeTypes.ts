import type { ExportProgressEvent, ExportRenderResult } from '../render/exportRenderer'

export interface VideoEditorHarnessActions {
	createProject(title?: string): void
	setActiveProject(projectId: string): void
	importSampleResource(): void
	importFiles(files: FileList | File[]): void
	addTextClip(content?: string): void
	selectEntity(entityId: string | null): void
	setActiveInspectorTab(tab: 'edit' | 'color' | 'audio' | 'export'): void
	deleteSelectedClip(): void
	splitSelectedClip(): void
	queueClipExportById(clipId: string, onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	queueSelectedClipExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	queueProjectExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	togglePlayback(): void
	setCursor(value: number): void
	tickPlayback(deltaSeconds: number): void
	zoomTimeline(delta: number): void
}

export interface CreateEditorHarnessAdapterOptions {
	resourceChunkSize: number
}
