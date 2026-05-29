import type { ReactSyncScopeHandle } from "../../dkt-react-sync/scope/ScopeHandle";

export type MediaImportEntry = File | { file: File; handle: FileSystemFileHandle };

export interface VideoEditorHarnessActions {
	createProject(title?: string): void;
	setActiveProject(projectId: string): void;
	addTextClip(content?: string): void;
	stageImportFiles(files: FileList | File[]): string | null;
	importFilesIntoProject(
		files: FileList | File[] | MediaImportEntry[],
		projectScope: ReactSyncScopeHandle,
	): void;
	requestImportFiles(files: FileList | File[]): void;
	requestSelectedClipExport(): void;
	requestProjectExport(): void;
	getCachedExportUrl(exportId: string): string | null;
	setCursor(value: number): void;
}
