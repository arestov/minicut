import type { EditorActionScope } from './actionScope'
import type { EditorSessionState, EffectAttrs, TextAttrs } from './types'

export type TimelineEdge = 'start' | 'end'
export type FadeEdge = 'in' | 'out'
export type TransformKey = 'x' | 'y' | 'scale' | 'rotation'
export type AudioKey = 'gain' | 'pan'
export type BasicEffectKind = 'blur' | 'sharpen' | 'tint'

export interface EditorActionPayloads {
	createProject: string | { title?: string } | undefined
	setActiveProject: string | { projectId: string }
	importSampleResource: undefined
	importFiles: { files: FileList | File[] }
	addTextClip: { content?: string } | undefined
	addResourceToTimeline: undefined
	setActiveInspectorTab: { tab: EditorSessionState['activeInspectorTab'] }
	tickPlayback: { deltaSeconds: number }
	addTrack: { kind: 'video' | 'audio' }
	setCursor: { value: number }
	zoomTimeline: { delta: number }
	togglePlayback: undefined
	select: undefined
	selectEntity: { entityId: string | null }
	moveBy: { delta: number }
	resize: { edge: TimelineEdge; delta: number }
	deleteClip: undefined
	splitAt: { time: number }
	splitSelectedClip: undefined
	nudgeSelectedClip: { delta: number }
	deleteSelectedClip: undefined
	rename: { name: string }
	color: { color: string }
	setOpacity: { opacityPercent: number }
	setFade: { edge: FadeEdge; delta: number }
	setTransform: Partial<Record<TransformKey, number>>
	setAudio: Partial<Record<AudioKey, number>>
	trim: { edge: TimelineEdge; delta: number }
	addEffect: { kind: BasicEffectKind }
	addColorCorrection: undefined
	updateText: Partial<TextAttrs>
	updateEffect: Partial<EffectAttrs>
	removeEffect: { effectId: string }
	queueClipExport: undefined
	queueProjectExport: undefined
}

export type EditorActionName = keyof EditorActionPayloads
export type EditorActionPayload<Name extends EditorActionName = EditorActionName> = EditorActionPayloads[Name]

export interface EditorActionRequest<Name extends EditorActionName = EditorActionName> {
	scope: EditorActionScope
	name: Name
	payload: EditorActionPayload<Name>
}

export const createEditorActionRequest = <Name extends EditorActionName>(
	scope: EditorActionScope,
	name: Name,
	payload: EditorActionPayload<Name>,
): EditorActionRequest<Name> => ({ scope, name, payload })
