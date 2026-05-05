import { buildEditorActionCommand } from '../domain/actionCommandBuilders'
import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EditorActionScope } from '../domain/actionScope'
import { getSelectedClip } from '../domain/selectors'
import type { ClipAttrs, EffectAttrs, TextAttrs } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import { createSessionRootActions } from './sessionRootActions'
import { createExportActions } from './exportActions'
import { createMediaImportActions } from './mediaImportActions'
import { getActionActiveProjectId } from './actionRuntimeSelectors'
import { executeActionBuildResult, type ExecuteActionTransactionOptions } from './actionTransactionExecutor'
import type { DktClipActionName, DktTimelineClipActionName } from '../models/Clip/actions'
import type { DktTextActionName } from '../models/Text/actions'
import type { DktEffectActionName } from '../models/Effect/actions'

const minimumSplitOffset = 0.01

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs
const asTextAttrs = (attrs: Record<string, unknown>): TextAttrs => attrs as unknown as TextAttrs
const asEffectAttrs = (attrs: Record<string, unknown>): EffectAttrs => attrs as unknown as EffectAttrs

const createScope = (nodeId: string, type: EditorActionScope['type']): EditorActionScope => ({ nodeId, type })

/** @deprecated Compatibility bridge while import/export and preview still mirror through command envelopes. */
export const createDktActionRuntime = (
	env: EditorActionEnvironment,
	options: CreateDktActionRuntimeOptions,
): VideoEditorHarnessActions => {
	const dispatchModelAction = <Name extends EditorActionName>(
		scope: EditorActionScope,
		name: Name,
		payload: EditorActionPayload<Name>,
		contextOverrides: Partial<Parameters<typeof buildEditorActionCommand>[1]> = {},
		executionOptions: ExecuteActionTransactionOptions = {},
	): void => {
		const result = buildEditorActionCommand({ scope, name, payload }, {
			registry: env.stores.getRegistry(),
			activeProjectId: name === 'createProject' ? null : getActionActiveProjectId(env),
			selectedEntityId: env.session.get().selectedEntityId,
			...contextOverrides,
		})
		void executeActionBuildResult(env, result, { applySessionPatch, ...executionOptions })
	}
	const dispatchDktClipAction = (clipId: string, clipAttrs: ClipAttrs, actionName: DktClipActionName | DktTimelineClipActionName, payload: unknown): void => {
		const dispatch = env.dkt?.dispatchClipAction
		if (!dispatch) {
			return
		}

		void Promise.resolve(dispatch({
			sourceClipId: clipId,
			name: clipAttrs.name,
			color: clipAttrs.color,
			start: clipAttrs.start,
			in: clipAttrs.in,
			duration: clipAttrs.duration,
			fadeIn: clipAttrs.fadeIn,
			fadeOut: clipAttrs.fadeOut,
			audio: clipAttrs.audio,
			opacity: clipAttrs.opacity,
			transform: clipAttrs.transform,
		}, actionName, payload)).catch(() => undefined)
	}
	const dispatchDktTextAction = (textId: string, textAttrs: TextAttrs, attrs: Partial<TextAttrs>): void => {
		const dispatch = env.dkt?.dispatchTextAction
		if (!dispatch) {
			return
		}

		const textProxy = {
			sourceTextId: textId,
			content: textAttrs.content,
			style: textAttrs.style,
			box: textAttrs.box,
		}
		const dktActions: Array<[DktTextActionName, unknown]> = []
		if ('content' in attrs) {
			dktActions.push(['setTextContent', { content: attrs.content }])
		}
		if ('style' in attrs) {
			dktActions.push(['setTextStyle', { style: attrs.style }])
		}
		if ('box' in attrs) {
			dktActions.push(['setTextBox', { box: attrs.box }])
		}

		void Promise.all(dktActions.map(([actionName, payload]) => dispatch(textProxy, actionName, payload))).catch(() => undefined)
	}
	const dispatchDktEffectAction = (effectId: string, effectAttrs: EffectAttrs, attrs: Partial<EffectAttrs>): void => {
		const dispatch = env.dkt?.dispatchEffectAction
		if (!dispatch) {
			return
		}

		const effectProxy = {
			sourceEffectId: effectId,
			name: effectAttrs.name,
			kind: effectAttrs.kind,
			enabled: effectAttrs.enabled,
			amount: effectAttrs.amount,
			params: effectAttrs.params as Record<string, unknown> | undefined,
			color: effectAttrs.color as Record<string, unknown> | undefined,
		}
		const dktActions: Array<[DktEffectActionName, unknown]> = []
		if ('name' in attrs) {
			dktActions.push(['setEffectName', { name: attrs.name }])
		}
		if ('kind' in attrs) {
			dktActions.push(['setEffectKind', { kind: attrs.kind }])
		}
		if ('enabled' in attrs) {
			dktActions.push(['setEffectEnabled', { enabled: attrs.enabled }])
		}
		if ('amount' in attrs) {
			dktActions.push(['setEffectAmount', { amount: attrs.amount }])
		}
		if ('params' in attrs) {
			dktActions.push(['setEffectParams', { params: attrs.params }])
		}
		if ('color' in attrs) {
			dktActions.push(['setEffectColor', { color: attrs.color }])
		}

		void Promise.all(dktActions.map(([actionName, payload]) => dispatch(effectProxy, actionName, payload))).catch(() => undefined)
	}
	const applySessionPatch = (patch: Record<string, unknown>): void => {
		if ('selectedEntityId' in patch) {
			env.session.selectEntity((patch.selectedEntityId as string | null | undefined) ?? null)
		}
	}
	const sessionRootActions = createSessionRootActions(env, options, dispatchModelAction)
	const exportActions = createExportActions(env)
	const mediaImportActions = createMediaImportActions(env, options, () => actions)

	const actions: VideoEditorHarnessActions = {
		...sessionRootActions,
		...exportActions,
		...mediaImportActions,

		updateSelectedText(attrs: Partial<TextAttrs>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			const textId = clip?.rels.text
			if (typeof textId !== 'string') {
				return
			}

			actions.updateTextById(textId, attrs)
		},

		renameClipById(clipId: string, name: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'rename', { name })
			dispatchModelAction(createScope(clipId, 'clip'), 'rename', { name })
		},

		renameSelectedClip(name: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.renameClipById(clip.id, name)
			}
		},

		colorClipById(clipId: string, color: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'color', { color })
			dispatchModelAction(createScope(clipId, 'clip'), 'color', { color })
		},

		colorSelectedClip(color: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.colorClipById(clip.id, color)
			}
		},

		updateClipOpacityById(clipId: string, opacityPercent: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'updateOpacity', { opacityPercent })
			dispatchModelAction(createScope(clipId, 'clip'), 'setOpacity', { opacityPercent })
		},

		updateSelectedClipOpacity(opacityPercent: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipOpacityById(clip.id, opacityPercent)
			}
		},

		updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'setFade', { edge, delta })
			dispatchModelAction(createScope(clipId, 'clip'), 'setFade', { edge, delta })
		},

		updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipFadeById(clip.id, edge, delta)
			}
		},

		updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'setTransform', partial)
			dispatchModelAction(createScope(clipId, 'clip'), 'setTransform', partial)
		},

		updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipTransformById(clip.id, partial)
			}
		},

		updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'setAudio', partial)
			dispatchModelAction(createScope(clipId, 'clip'), 'setAudio', partial)
		},

		updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipAudioById(clip.id, partial)
			}
		},

		trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'trim', { edge, delta })
			dispatchModelAction(createScope(clipId, 'clip'), 'trim', { edge, delta })
		},

		trimSelectedClip(edge: 'start' | 'end', delta: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.trimClipById(clip.id, edge, delta)
			}
		},

		resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			if (delta === 0) {
				return
			}

			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'resize', { edge, delta })
			dispatchModelAction(createScope(clipId, 'clip'), 'resize', { edge, delta })
		},

		addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchModelAction(createScope(clipId, 'clip'), 'addEffect', { kind })
		},

		addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.addEffectToClip(clip.id, kind)
			}
		},

		addColorCorrectionToClip(clipId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchModelAction(createScope(clipId, 'clip'), 'addColorCorrection', undefined)
		},

		addColorCorrectionToSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.addColorCorrectionToClip(clip.id)
			}
		},

		updateTextById(textId: string, attrs: Partial<TextAttrs>): void {
			const text = env.stores.getRegistry().entitiesById[textId]
			if (text?.type === 'text') {
				dispatchDktTextAction(text.id, asTextAttrs(text.attrs), attrs)
			}

			dispatchModelAction(createScope(textId, 'text'), 'updateText', attrs)
		},

		updateEffectAttrs(effectId, attrs): void {
			const effect = env.stores.getRegistry().entitiesById[effectId]
			if (effect?.type === 'effect') {
				dispatchDktEffectAction(effect.id, asEffectAttrs(effect.attrs), attrs)
			}

			dispatchModelAction(createScope(effectId, 'effect'), 'updateEffect', attrs)
		},

		deleteClipById(clipId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchModelAction(createScope(clipId, 'clip'), 'deleteClip', undefined)
		},

		deleteSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.deleteClipById(clip.id)
			}
		},

		splitSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const splitTime = clamp(roundToHundredths(env.session.get().cursor), attrs.start + minimumSplitOffset, attrs.start + attrs.duration - minimumSplitOffset)
			dispatchDktClipAction(clip.id, attrs, 'splitAt', { time: splitTime })
			dispatchModelAction(createScope(clip.id, 'clip'), 'splitAt', { time: splitTime }, { selectCreatedClipOnSplit: true })
		},

		splitClipByIdAt(clipId: string, time: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const splitTime = clamp(roundToHundredths(time), attrs.start + minimumSplitOffset, attrs.start + attrs.duration - minimumSplitOffset)
			dispatchDktClipAction(clip.id, attrs, 'splitAt', { time: splitTime })
			dispatchModelAction(createScope(clipId, 'clip'), 'splitAt', { time: splitTime }, { selectCreatedClipOnSplit: true })
		},

		removeEffectFromClip(clipId: string, effectId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchModelAction(createScope(clipId, 'clip'), 'removeEffect', { effectId })
		},

		removeEffectFromSelectedClip(effectId: string): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.removeEffectFromClip(clip.id, effectId)
			}
		},

		nudgeSelectedClip(delta: number): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (!clip) {
				return
			}

			actions.moveClipById(clip.id, delta)
		},

		moveClipById(clipId: string, delta: number): void {
			if (delta === 0) {
				return
			}

			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (clip?.type === 'clip') {
				dispatchDktClipAction(clip.id, asClipAttrs(clip.attrs), 'moveBy', { delta })
			}

			dispatchModelAction(createScope(clipId, 'clip'), 'moveBy', { delta })
		},
	}

	return actions
}

