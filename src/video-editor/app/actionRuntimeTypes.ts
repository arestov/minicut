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
	renameClipById(clipId: string, name: string): void
	renameSelectedClip(name: string): void
	colorClipById(clipId: string, color: string): void
	colorSelectedClip(color: string): void
	updateClipOpacityById(clipId: string, opacityPercent: number): void
	updateSelectedClipOpacity(opacityPercent: number): void
	updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void
	updateSelectedClipFade(edge: 'in' | 'out', delta: number): void
	updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void
	updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void
	updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void
	updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void
	trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void
	trimSelectedClip(edge: 'start' | 'end', delta: number): void
	resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void
	addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void
	addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void
	addColorCorrectionToClip(clipId: string): void
	addColorCorrectionToSelectedClip(): void
	updateTextById(textId: string, attrs: Partial<TextAttrs>): void
	updateEffectAttrs(effectId: string, attrs: Partial<EffectAttrs>): void
	deleteClipById(clipId: string): void
	deleteSelectedClip(): void
	splitSelectedClip(): void
	splitClipByIdAt(clipId: string, time: number): void
	removeEffectFromClip(clipId: string, effectId: string): void
	removeEffectFromSelectedClip(effectId: string): void
	queueClipExportById(clipId: string, onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	queueSelectedClipExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	queueProjectExport(onProgress?: (event: ExportProgressEvent) => void): Promise<ExportRenderResult | null>
	nudgeSelectedClip(delta: number): void
	moveClipById(clipId: string, delta: number): void
	togglePlayback(): void
	setCursor(value: number): void
	tickPlayback(deltaSeconds: number): void
	zoomTimeline(delta: number): void
}

export interface CreateDktActionRuntimeOptions {
	playbackDuration$: Observable<number>
	resourceChunkSize: number
}

export type ClipResizeAttrs = Pick<ClipAttrs, 'start' | 'in' | 'duration'> | Pick<ClipAttrs, 'duration'>
