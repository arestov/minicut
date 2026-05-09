export interface VideoEditorHarnessActions {
	createProject(title?: string): void
	setActiveProject(projectId: string): void
	addTextClip(content?: string): void
	requestImportFiles(files: FileList | File[]): void
	requestSelectedClipExport(): void
	requestProjectExport(): void
	getCachedExportUrl(exportId: string): string | null
	setCursor(value: number): void
}
