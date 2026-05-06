import type { EffectAttrs } from '../models/Effect/types'
import type { TextAttrs } from '../models/Text/types'
import { createProjectImportFilesEffectPayload, PROJECT_IMPORT_FILES_FX, createProjectRenderExportEffectData, PROJECT_RENDER_EXPORT_FX } from '../models/Project/effects'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const getRootScope = (env: EditorActionEnvironment) => env.dkt?.getRootScope() ?? null

const dispatchRoot = (env: EditorActionEnvironment, actionName: string, payload?: unknown): void => {
env.dkt?.dispatch(actionName, payload, getRootScope(env))
}

const queueImportFilesTask = (env: EditorActionEnvironment, files: FileList | File[]) => {
const task = env.tasks.dispatchTask(
PROJECT_IMPORT_FILES_FX,
createProjectImportFilesEffectPayload(files, { projectId: '' }),
{ queuePolicy: 'queue-all', intentKey: PROJECT_IMPORT_FILES_FX },
)
env.tasks.completeTask(task)
}

const queueExportTask = (env: EditorActionEnvironment, range: 'project' | 'clip', clipId?: string): void => {
const task = env.tasks.dispatchTask(
PROJECT_RENDER_EXPORT_FX,
{ data: createProjectRenderExportEffectData({ projectId: '', clipId, range, format: 'video-webm' }) },
{ queuePolicy: 'queue-all', intentKey: `${PROJECT_RENDER_EXPORT_FX}:${range}` },
)
env.tasks.completeTask(task)
}

export const createDktActionRuntime = (
env: EditorActionEnvironment,
_options: CreateDktActionRuntimeOptions,
): VideoEditorHarnessActions => ({
createProject(title?: string): void {
dispatchRoot(env, 'createProject', { title })
},
setActiveProject(projectId: string): void {
dispatchRoot(env, 'setActiveProject', projectId)
},
importSampleResource(): void {
dispatchRoot(env, 'importSampleResource')
},
importFiles(files: FileList | File[]): void {
queueImportFilesTask(env, files)
dispatchRoot(env, 'importFilesRequested')
},
addResourceToTimeline(resourceId: string): void {
dispatchRoot(env, 'addResourceToTimeline', { resourceId })
},
addTextClip(content?: string): void {
dispatchRoot(env, 'addTextClip', { content })
},
updateSelectedText(): void {},
addTrack(kind: 'video' | 'audio'): void {
dispatchRoot(env, 'addTrack', { kind })
},
selectEntity(entityId: string | null): void {
dispatchRoot(env, 'selectEntity', entityId)
},
setActiveInspectorTab(tab): void {
dispatchRoot(env, 'setActiveInspectorTab', tab)
},
renameClipById(clipId: string, name: string): void {
dispatchRoot(env, 'renameClipById', { clipId, name })
},
renameSelectedClip(name: string): void {
dispatchRoot(env, 'renameSelectedClip', { name })
},
colorClipById(clipId: string, color: string): void {
dispatchRoot(env, 'colorClipById', { clipId, color })
},
colorSelectedClip(color: string): void {
dispatchRoot(env, 'colorSelectedClip', { color })
},
updateClipOpacityById(clipId: string, opacityPercent: number): void {
dispatchRoot(env, 'updateClipOpacityById', { clipId, opacityPercent })
},
updateSelectedClipOpacity(opacityPercent: number): void {
dispatchRoot(env, 'updateSelectedClipOpacity', { opacityPercent })
},
updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void {
dispatchRoot(env, 'updateClipFadeById', { clipId, edge, delta })
},
updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
dispatchRoot(env, 'updateSelectedClipFade', { edge, delta })
},
updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
dispatchRoot(env, 'updateClipTransformById', { clipId, partial })
},
updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
dispatchRoot(env, 'updateSelectedClipTransform', { partial })
},
updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void {
dispatchRoot(env, 'updateClipAudioById', { clipId, partial })
},
updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
dispatchRoot(env, 'updateSelectedClipAudio', { partial })
},
trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
dispatchRoot(env, 'trimClipById', { clipId, edge, delta })
},
trimSelectedClip(edge: 'start' | 'end', delta: number): void {
dispatchRoot(env, 'trimSelectedClip', { edge, delta })
},
resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
dispatchRoot(env, 'resizeClipById', { clipId, edge, delta })
},
addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void {
dispatchRoot(env, 'addEffectToClip', { clipId, kind })
},
addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
dispatchRoot(env, 'addEffectToSelectedClip', { kind })
},
addColorCorrectionToClip(clipId: string): void {
dispatchRoot(env, 'addColorCorrectionToClip', { clipId })
},
addColorCorrectionToSelectedClip(): void {
dispatchRoot(env, 'addColorCorrectionToSelectedClip')
},
updateTextById(textId: string, attrs: Partial<TextAttrs>): void {
dispatchRoot(env, 'updateTextById', { textId, attrs })
},
updateEffectAttrs(effectId: string, attrs: Partial<EffectAttrs>): void {
dispatchRoot(env, 'updateEffectAttrs', { effectId, attrs })
},
deleteClipById(clipId: string): void {
dispatchRoot(env, 'deleteClipById', { clipId })
},
deleteSelectedClip(): void {
dispatchRoot(env, 'deleteSelectedClip')
},
splitSelectedClip(): void {
dispatchRoot(env, 'splitSelectedClip')
},
splitClipByIdAt(clipId: string, time: number): void {
dispatchRoot(env, 'splitClipByIdAt', { clipId, time: roundToHundredths(time) })
},
removeEffectFromClip(clipId: string, effectId: string): void {
dispatchRoot(env, 'removeEffectFromClip', { clipId, effectId })
},
removeEffectFromSelectedClip(effectId: string): void {
dispatchRoot(env, 'removeEffectFromSelectedClip', { effectId })
},
queueClipExportById(clipId: string): Promise<null> {
queueExportTask(env, 'clip', clipId)
return Promise.resolve(null)
},
queueSelectedClipExport(): Promise<null> {
queueExportTask(env, 'clip')
return Promise.resolve(null)
},
queueProjectExport(): Promise<null> {
queueExportTask(env, 'project')
return Promise.resolve(null)
},
nudgeSelectedClip(delta: number): void {
dispatchRoot(env, 'nudgeSelectedClip', { delta })
},
moveClipById(clipId: string, delta: number): void {
dispatchRoot(env, 'moveClipById', { clipId, delta })
},
togglePlayback(): void {
dispatchRoot(env, 'togglePlayback')
},
setCursor(value: number): void {
dispatchRoot(env, 'setCursor', value)
},
tickPlayback(deltaSeconds: number): void {
dispatchRoot(env, 'tickPlayback', { deltaSeconds })
},
zoomTimeline(delta: number): void {
dispatchRoot(env, 'zoomTimeline', { delta })
},
})
