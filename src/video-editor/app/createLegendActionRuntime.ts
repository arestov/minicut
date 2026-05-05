import { buildEditorActionCommand } from '../domain/actionCommandBuilders'
import { commandStep, createdIdRef } from '../domain/actionTransactions'
import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EditorActionScope } from '../domain/actionScope'
import { getSelectedClip } from '../domain/selectors'
import type { ClipAttrs, TextAttrs } from '../domain/types'
import { CMD } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateLegendActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import { createSessionRootActions } from './sessionRootActions'
import { createExportActions } from './exportActions'
import { createMediaImportActions } from './mediaImportActions'
import { getActionActiveProjectId } from './actionRuntimeSelectors'
import { executeActionBuildResult } from './actionTransactionExecutor'
import type { DktClipActionName } from '../dkt/clipActions'

const minimumSplitOffset = 0.01

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const asClipAttrs = (attrs: Record<string, unknown>): ClipAttrs => attrs as unknown as ClipAttrs

const createScope = (nodeId: string, type: EditorActionScope['type']): EditorActionScope => ({ nodeId, type })

export const createLegendActionRuntime = (
	env: EditorActionEnvironment,
	options: CreateLegendActionRuntimeOptions,
): VideoEditorHarnessActions => {
	const dispatchBuiltCommand = <Name extends EditorActionName>(scope: EditorActionScope, name: Name, payload: EditorActionPayload<Name>): void => {
		const result = buildEditorActionCommand({ scope, name, payload }, {
			registry: env.stores.getRegistry(),
			activeProjectId: getActionActiveProjectId(env),
		})
		void executeActionBuildResult(env, result)
	}
	const dispatchDktClipAction = (clipId: string, clipAttrs: ClipAttrs, actionName: DktClipActionName, payload: unknown): void => {
		const dispatch = env.dkt?.dispatchClipAction
		if (!dispatch) {
			return
		}

		void Promise.resolve(dispatch({
			sourceClipId: clipId,
			name: clipAttrs.name,
			color: clipAttrs.color,
			duration: clipAttrs.duration,
			fadeIn: clipAttrs.fadeIn,
			fadeOut: clipAttrs.fadeOut,
			audio: clipAttrs.audio,
			opacity: clipAttrs.opacity,
			transform: clipAttrs.transform,
		}, actionName, payload)).catch(() => undefined)
	}
	const applySessionPatch = (patch: Record<string, unknown>): void => {
		if ('selectedEntityId' in patch) {
			env.session.selectEntity((patch.selectedEntityId as string | null | undefined) ?? null)
		}
	}
	const sessionRootActions = createSessionRootActions(env, options, dispatchBuiltCommand)
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
			dispatchBuiltCommand(createScope(clipId, 'clip'), 'rename', { name })
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
			dispatchBuiltCommand(createScope(clipId, 'clip'), 'color', { color })
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
			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setOpacity', { opacityPercent })
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
			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setFade', { edge, delta })
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
			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setTransform', partial)
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
			dispatchBuiltCommand(createScope(clipId, 'clip'), 'setAudio', partial)
		},

		updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.updateClipAudioById(clip.id, partial)
			}
		},

		trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'trim', { edge, delta })
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

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'resize', { edge, delta })
		},

		addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'addEffect', { kind })
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

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'addColorCorrection', undefined)
		},

		addColorCorrectionToSelectedClip(): void {
			const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
			if (clip) {
				actions.addColorCorrectionToClip(clip.id)
			}
		},

		updateTextById(textId: string, attrs: Partial<TextAttrs>): void {
			dispatchBuiltCommand(createScope(textId, 'text'), 'updateText', attrs)
		},

		updateEffectAttrs(effectId, attrs): void {
			dispatchBuiltCommand(createScope(effectId, 'effect'), 'updateEffect', attrs)
		},

		deleteClipById(clipId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			const shouldClearSelection = env.session.get().selectedEntityId === clipId
			const result = shouldClearSelection
				? {
						type: 'transaction' as const,
						steps: [
							commandStep({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: clipId } }),
							{ type: 'session' as const, patch: { selectedEntityId: null } },
						],
				  }
				: commandStep({ c: CMD.TIMELINE_DELETE_CLIP, p: { id: clipId } })
			void executeActionBuildResult(env, result, { applySessionPatch })
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
			void executeActionBuildResult(env, {
				type: 'transaction',
				steps: [
					commandStep(
						{ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: clip.id, time: splitTime } },
						{ holdCreatedIdAs: 'split.clip' },
					),
					{ type: 'session', patch: { selectedEntityId: createdIdRef('split.clip') } },
				],
			}, { applySessionPatch })
		},

		splitClipByIdAt(clipId: string, time: number): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip || clip.type !== 'clip') {
				return
			}

			const attrs = asClipAttrs(clip.attrs)
			const splitTime = clamp(roundToHundredths(time), attrs.start + minimumSplitOffset, attrs.start + attrs.duration - minimumSplitOffset)
			void executeActionBuildResult(env, {
				type: 'transaction',
				steps: [
					commandStep(
						{ c: CMD.TIMELINE_SPLIT_CLIP, p: { id: clipId, time: splitTime } },
						{ holdCreatedIdAs: 'split.clip' },
					),
					{ type: 'session', patch: { selectedEntityId: createdIdRef('split.clip') } },
				],
			}, { applySessionPatch })
		},

		removeEffectFromClip(clipId: string, effectId: string): void {
			const clip = env.stores.getRegistry().entitiesById[clipId]
			if (!clip) {
				return
			}

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'removeEffect', { effectId })
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

			dispatchBuiltCommand(createScope(clipId, 'clip'), 'moveBy', { delta })
		},
	}

	return actions
}
