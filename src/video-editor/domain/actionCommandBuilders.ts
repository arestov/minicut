import {
	clipSetAudioAction,
	clipSetFadeAction,
	clipSetTransformAction,
	reduceClipColorAction,
	reduceClipRenameAction,
	reduceClipUpdateOpacityAction,
} from '../models/Clip/actions'
import {
	reduceTimelineResizeAction,
	reduceTimelineTrimAction,
} from '../models/Clip/actions'
import type { EditorActionName, EditorActionRequest } from './actionRequests'
import type { EditorActionScope } from './actionScope'
import type { ClipAttrs, Command, EffectAttrs, ProjectRegistry, TextAttrs } from './types'
import { CMD } from './types'
import { commandStep, createdIdRef, type EditorActionBuildResult } from './actionTransactions'

export interface ResourceImportCommandInput {
	projectId: string | null
	name: string
	kind: 'video' | 'audio' | 'image'
	duration: number
	mime?: string
	url?: string
	width?: number
	height?: number
	size?: number
	source?: { kind: 'local' } | { kind: 'p2p'; ownerPeerId?: string | null }
	dataStatus?: 'missing' | 'partial' | 'ready' | 'loading' | 'error'
	chunkSize?: number
}

export const createProjectCreationCommand = (title?: string): Command => ({
	c: CMD.PROJECT_CREATE,
	p: { title },
})

export const createResourceImportCommand = (input: ResourceImportCommandInput): Command => ({
	c: CMD.RESOURCE_IMPORT,
	p: input,
})

export const createTimelineAddClipCommand = (input: {
	projectId: string | null
	resourceId: string
	trackId: string
	includeLinkedAudio?: boolean
}): Command => ({
	c: CMD.TIMELINE_ADD_CLIP,
	p: input,
})

export const createTextAddCommand = (input: { projectId: string | null; content?: string }): Command => ({
	c: CMD.TEXT_ADD,
	p: input,
})

const noAction = (): EditorActionBuildResult => ({ type: 'none' })

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs

const getClip = (registry: ProjectRegistry, scope: EditorActionScope) => {
	const clip = registry.entitiesById[scope.nodeId]
	return clip?.type === 'clip' ? clip : null
}

export interface EditorActionCommandBuilderContext {
	registry: ProjectRegistry
	activeProjectId: string | null
	selectedEntityId?: string | null
	selectCreatedClipOnSplit?: boolean
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
	deleteClip: (_payload, _clipAttrs, clipId) =>
		commandStep({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: clipId } }),
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

/** @deprecated Compatibility command builders retained until all UI writes are DKT scoped model actions. */
export const buildEditorActionCommand = (
	request: EditorActionRequest,
	context: EditorActionCommandBuilderContext,
): EditorActionBuildResult => {
	const { scope, name, payload } = request

	if (name === 'createProject') {
		const title = typeof payload === 'string'
			? payload
			: (payload as { title?: unknown } | undefined)?.title
		return {
			type: 'transaction',
			steps: [
				commandStep(
					createProjectCreationCommand(typeof title === 'string' ? title : undefined),
					{ holdCreatedIdAs: 'project.new', createdIdKey: 'projectId' },
				),
				{
					type: 'session',
					patch: {
						activeProjectId: createdIdRef('project.new'),
						selectedEntityId: null,
						cursor: 0,
					},
				},
			],
		}
	}

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
	if (name === 'deleteClip') {
		const step = clipActionCommandBuilders.deleteClip?.(payload, clipAttrs, scope.nodeId) ?? noAction()
		return context.selectedEntityId === scope.nodeId
			? {
					type: 'transaction',
					steps: [
						step,
						{ type: 'session', patch: { selectedEntityId: null } },
					],
			  }
			: step
	}
	if (name === 'splitAt' && context.selectCreatedClipOnSplit) {
		const time = (payload as { time?: unknown } | undefined)?.time
		return typeof time === 'number'
			? {
					type: 'transaction',
					steps: [
						commandStep(
							{ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: scope.nodeId, time } },
							{ holdCreatedIdAs: 'split.clip' },
						),
						{ type: 'session', patch: { selectedEntityId: createdIdRef('split.clip') } },
					],
			  }
			: noAction()
	}
	return clipActionCommandBuilders[name]?.(payload, clipAttrs, scope.nodeId) ?? noAction()
}

export const expectCommand = (result: EditorActionBuildResult): Command | null =>
	result.type === 'command' ? result.command : null
