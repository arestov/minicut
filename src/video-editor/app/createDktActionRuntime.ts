import { buildEditorActionCommand } from '../domain/actionCommandBuilders'
import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EditorActionScope } from '../domain/actionScope'
import type { EffectAttrs, TextAttrs } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import { createSessionRootActions } from './sessionRootActions'
import { createExportActions } from './exportActions'
import { createMediaImportActions } from './mediaImportActions'
import { getActionActiveProjectId } from './actionRuntimeSelectors'
import { executeActionBuildResult, type ExecuteActionTransactionOptions } from './actionTransactionExecutor'
import type { DktClipActionName, DktTimelineClipActionName } from '../models/Clip/actions'
import type { DktEffectActionName } from '../models/Effect/actions'
import type { DktTextActionName } from '../models/Text/actions'

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const getSelectedEntityId = (env: EditorActionEnvironment): string | null => {
	const selectedEntityId = env.session.get().selectedEntityId
	return typeof selectedEntityId === 'string' && selectedEntityId ? selectedEntityId : null
}

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
	const dispatchDktClipAction = (clipId: string, actionName: DktClipActionName | DktTimelineClipActionName, payload: unknown): void => {
		const dispatch = env.dkt?.dispatchClipAction
		if (!dispatch) {
			return
		}

		void Promise.resolve(dispatch({
			sourceClipId: clipId,
		}, actionName, payload)).catch(() => undefined)
	}
	const dispatchDktTextAction = (textId: string, actionName: DktTextActionName, payload: unknown): void => {
		const dispatch = env.dkt?.dispatchTextAction
		if (!dispatch) {
			return
		}

		void Promise.resolve(dispatch({ sourceTextId: textId }, actionName, payload)).catch(() => undefined)
	}
	const dispatchDktEffectAction = (effectId: string, attrs: Partial<EffectAttrs>): void => {
		const dispatch = env.dkt?.dispatchEffectAction
		if (!dispatch) {
			return
		}

		const effectSeed = { sourceEffectId: effectId }
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

		void Promise.all(dktActions.map(([actionName, payload]) => dispatch(effectSeed, actionName, payload))).catch(() => undefined)
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

		updateSelectedText(): void {
		},

		renameClipById(clipId: string, name: string): void {
			dispatchDktClipAction(clipId, 'rename', { name })
		},

		renameSelectedClip(name: string): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.renameClipById(clipId, name)
			}
		},

		colorClipById(clipId: string, color: string): void {
			dispatchDktClipAction(clipId, 'color', { color })
		},

		colorSelectedClip(color: string): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.colorClipById(clipId, color)
			}
		},

		updateClipOpacityById(clipId: string, opacityPercent: number): void {
			dispatchDktClipAction(clipId, 'updateOpacity', { opacityPercent })
		},

		updateSelectedClipOpacity(opacityPercent: number): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipOpacityById(clipId, opacityPercent)
			}
		},

		updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void {
			dispatchDktClipAction(clipId, 'setFade', { edge, delta })
		},

		updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipFadeById(clipId, edge, delta)
			}
		},

		updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			dispatchDktClipAction(clipId, 'setTransform', partial)
		},

		updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipTransformById(clipId, partial)
			}
		},

		updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void {
			dispatchDktClipAction(clipId, 'setAudio', partial)
		},

		updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipAudioById(clipId, partial)
			}
		},

		trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			dispatchDktClipAction(clipId, 'trim', { edge, delta })
		},

		trimSelectedClip(edge: 'start' | 'end', delta: number): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.trimClipById(clipId, edge, delta)
			}
		},

		resizeClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			if (delta === 0) {
				return
			}

			dispatchDktClipAction(clipId, 'resize', { edge, delta })
		},

		addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void {
			dispatchDktClipAction(clipId, 'addEffect', { kind })
		},

		addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.addEffectToClip(clipId, kind)
			}
		},

		addColorCorrectionToClip(clipId: string): void {
			dispatchDktClipAction(clipId, 'addEffect', { kind: 'tint' })
		},

		addColorCorrectionToSelectedClip(): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.addColorCorrectionToClip(clipId)
			}
		},

		updateTextById(textId: string, attrs: Partial<TextAttrs>): void {
			if ('content' in attrs) {
				dispatchDktTextAction(textId, 'setTextContent', { content: attrs.content })
			}
			if ('style' in attrs) {
				dispatchDktTextAction(textId, 'setTextStyle', { style: attrs.style })
			}
			if ('box' in attrs) {
				dispatchDktTextAction(textId, 'setTextBox', { box: attrs.box })
			}
		},

		updateEffectAttrs(effectId, attrs): void {
			dispatchDktEffectAction(effectId, attrs)
		},

		deleteClipById(clipId: string): void {
			dispatchDktClipAction(clipId, 'setTimelineAttrs', { duration: 0 })
		},

		deleteSelectedClip(): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.deleteClipById(clipId)
			}
		},

		splitSelectedClip(): void {
			const clipId = getSelectedEntityId(env)
			if (!clipId) {
				return
			}

			dispatchDktClipAction(clipId, 'splitAt', { time: roundToHundredths(env.session.get().cursor) })
		},

		splitClipByIdAt(clipId: string, time: number): void {
			dispatchDktClipAction(clipId, 'splitAt', { time: roundToHundredths(time) })
		},

		removeEffectFromClip(clipId: string, effectId: string): void {
			dispatchDktClipAction(clipId, 'removeEffect', { effectId })
		},

		removeEffectFromSelectedClip(effectId: string): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.removeEffectFromClip(clipId, effectId)
			}
		},

		nudgeSelectedClip(delta: number): void {
			const clipId = getSelectedEntityId(env)
			if (!clipId) {
				return
			}

			actions.moveClipById(clipId, delta)
		},

		moveClipById(clipId: string, delta: number): void {
			if (delta === 0) {
				return
			}

			dispatchDktClipAction(clipId, 'moveBy', { delta })
		},
	}

	return actions
}

