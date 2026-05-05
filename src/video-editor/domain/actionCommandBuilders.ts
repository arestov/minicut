import {
	clipSetAudioAction,
	clipSetFadeAction,
	clipSetTransformAction,
	reduceClipColorAction,
	reduceClipRenameAction,
	reduceClipUpdateOpacityAction,
} from '../dkt/clipActions'
import {
	reduceTimelineResizeAction,
	reduceTimelineTrimAction,
} from '../dkt/timelineActions'
import type { EditorActionName, EditorActionRequest } from './actionRequests'
import type { EditorActionScope } from './actionScope'
import type { ClipAttrs, Command, EffectAttrs, ProjectRegistry, TextAttrs } from './types'
import { CMD } from './types'
import { commandStep, type EditorActionBuildResult } from './actionTransactions'

const noAction = (): EditorActionBuildResult => ({ type: 'none' })

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs

const getClip = (registry: ProjectRegistry, scope: EditorActionScope) => {
	const clip = registry.entitiesById[scope.nodeId]
	return clip?.type === 'clip' ? clip : null
}

export interface EditorActionCommandBuilderContext {
	registry: ProjectRegistry
	activeProjectId: string | null
}

type ClipActionCommandBuilder = (payload: unknown, clipAttrs: ClipAttrs, clipId: string) => EditorActionBuildResult

const updateClipAttrs = (clipId: string, attrs: Partial<ClipAttrs> | null): EditorActionBuildResult =>
	attrs ? commandStep({ c: CMD.CLIP_UPDATE_ATTRS, p: { id: clipId, attrs } }) : noAction()

const clipActionCommandBuilders: Partial<Record<EditorActionName, ClipActionCommandBuilder>> = {
	rename: (payload, _clipAttrs, clipId) => updateClipAttrs(clipId, reduceClipRenameAction(payload)),
	color: (payload, _clipAttrs, clipId) => updateClipAttrs(clipId, reduceClipColorAction(payload)),
	setOpacity: (payload, _clipAttrs, clipId) => updateClipAttrs(clipId, reduceClipUpdateOpacityAction(payload)),
	setFade: (payload, clipAttrs, clipId) => updateClipAttrs(clipId, clipSetFadeAction.fn(payload, clipAttrs)),
	setTransform: (payload, clipAttrs, clipId) => updateClipAttrs(clipId, clipSetTransformAction.fn(payload, clipAttrs.transform)),
	setAudio: (payload, clipAttrs, clipId) => updateClipAttrs(clipId, clipSetAudioAction.fn(payload, clipAttrs.audio)),
	trim: (payload, clipAttrs, clipId) => updateClipAttrs(clipId, reduceTimelineTrimAction(payload, clipAttrs)),
	resize: (payload, clipAttrs, clipId) => updateClipAttrs(clipId, reduceTimelineResizeAction(payload, clipAttrs)),
	moveBy: (payload, _clipAttrs, clipId) => {
		const delta = (payload as { delta?: unknown } | undefined)?.delta
		return typeof delta === 'number' && delta !== 0
			? commandStep({ c: CMD.TIMELINE_MOVE_CLIP, p: { id: clipId, delta } })
			: noAction()
	},
	splitAt: (payload, _clipAttrs, clipId) => {
		const time = (payload as { time?: unknown } | undefined)?.time
		return typeof time === 'number'
			? commandStep({ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: clipId, time } })
			: noAction()
	},
	addEffect: (payload, _clipAttrs, clipId) => {
		const kind = (payload as { kind?: unknown } | undefined)?.kind
		return kind === 'blur' || kind === 'sharpen' || kind === 'tint'
			? commandStep({ c: CMD.EFFECT_ADD, p: { id: clipId, name: `${kind[0].toUpperCase()}${kind.slice(1)}`, kind, amount: kind === 'tint' ? 0.35 : 0.25 } })
			: noAction()
	},
	addColorCorrection: (_payload, _clipAttrs, clipId) =>
		commandStep({ c: CMD.EFFECT_ADD, p: { id: clipId, name: 'Primary Correction', kind: 'color-correction' } }),
	removeEffect: (payload, _clipAttrs, clipId) => {
		const effectId = (payload as { effectId?: unknown } | undefined)?.effectId
		return typeof effectId === 'string'
			? commandStep({ c: CMD.EFFECT_REMOVE, p: { id: clipId, effectId } })
			: noAction()
	},
}

export const buildEditorActionCommand = (
	request: EditorActionRequest,
	context: EditorActionCommandBuilderContext,
): EditorActionBuildResult => {
	const { scope, name, payload } = request

	if (name === 'addTrack') {
		const kind = (payload as { kind?: unknown } | undefined)?.kind
		if (!context.activeProjectId || (kind !== 'video' && kind !== 'audio')) {
			return noAction()
		}

		return commandStep({ c: CMD.TRACK_CREATE, p: { projectId: context.activeProjectId, kind } })
	}

	if (scope.type === 'text' && name === 'updateText') {
		return commandStep({ c: CMD.TEXT_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: payload as Partial<TextAttrs> } })
	}

	if (scope.type === 'effect' && name === 'updateEffect') {
		return commandStep({ c: CMD.EFFECT_UPDATE_ATTRS, p: { id: scope.nodeId, attrs: payload as Partial<EffectAttrs> } })
	}

	if (scope.type !== 'clip') {
		return noAction()
	}

	const clip = getClip(context.registry, scope)
	if (!clip) {
		return noAction()
	}

	const clipAttrs = asClipAttrs(clip.attrs)
	return clipActionCommandBuilders[name]?.(payload, clipAttrs, scope.nodeId) ?? noAction()
}

export const expectCommand = (result: EditorActionBuildResult): Command | null =>
	result.type === 'command' ? result.command : null
