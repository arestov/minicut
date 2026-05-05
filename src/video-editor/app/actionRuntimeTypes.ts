import type { Observable } from '@legendapp/state'
import type { ClipAttrs, EffectAttrs, EditorSessionState, TextAttrs } from '../domain/types'
import type { ExportProgressEvent, ExportRenderResult } from '../render/exportRenderer'

export interface VideoEditorHarnessActions {
	createProject(title?: string): void
	setActiveProject(projectId: string): void
	undo(): void
	redo(): void
	importSampleResource(): void
	importFiles(files: FileList | File[]): void
	addResourceToTimeline(resourceId: string): void
	addTextClip(content?: string): void
	updateSelectedText(attrs: Partial<TextAttrs>): void
	addTrack(kind: 'video' | 'audio'): void
	selectEntity(entityId: string | null): void
	setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void
	renameSelectedClip(name: string): void
	colorSelectedClip(color: string): void
	updateSelectedClipOpacity(opacityPercent: number): void
	updateSelectedClipFade(edge: 'in' | 'out', delta: number): void
	updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void
	updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void
	trimSelectedClip(edge: 'start' | 'end', delta: number): void
	resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void
	addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void
	addColorCorrectionToSelectedClip(): void
	updateEffectAttrs(effectId: string, attrs: Partial<EffectAttrs>): void
	deleteSelectedClip(): void
	splitSelectedClip(): void
	splitClipByIdAt(clipId: string, time: number): void
	removeEffectFromSelectedClip(effectId: string): void
	queueSelectedClipExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	queueProjectExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	nudgeSelectedClip(delta: number): void
	moveClipById(clipId: string, delta: number): void
	togglePlayback(): void
	setCursor(value: number): void
	tickPlayback(deltaSeconds: number): void
	zoomTimeline(delta: number): void
}

export interface CreateLegendActionRuntimeOptions {
	playbackDuration$: Observable<number>
	resourceChunkSize: number
}

export type ClipResizeAttrs = Pick<ClipAttrs, 'start' | 'in' | 'duration'> | Pick<ClipAttrs, 'duration'>
