export interface VideoEditorHarnessActions {
	createProject(title?: string): void
	setActiveProject(projectId: string): void
	importSampleResource(): void
	addTextClip(content?: string): void
	selectEntity(entityId: string | null): void
	setActiveInspectorTab(tab: 'edit' | 'color' | 'audio' | 'export'): void
	deleteSelectedClip(): void
	splitSelectedClip(): void
	requestSelectedClipExport(): void
	requestProjectExport(): void
	getSessionRootNodeId(): string | null
	togglePlayback(): void
	setCursor(value: number): void
	tickPlayback(deltaSeconds: number): void
	zoomTimeline(delta: number): void
	getCachedExportUrl(exportId: string): string | null
}
