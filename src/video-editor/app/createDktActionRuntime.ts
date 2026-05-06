import type { EffectAttrs, TextAttrs } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import { createSessionRootActions } from './sessionRootActions'
import { createExportActions } from './exportActions'
import { createMediaImportActions } from './mediaImportActions'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

/** Traverse session root → activeProject → tracks → clips to find clip scope by sourceClipId. */
const findClipScope = (env: EditorActionEnvironment, clipId: string): ReactSyncScopeHandle | null => {
	const dkt = env.dkt
	if (!dkt) {
		return null
	}

	const rootScope = dkt.getRootScope()
	if (!rootScope) {
		return null
	}

	const projectScope = dkt.readOne(rootScope, 'activeProject')
	if (!projectScope) {
		return null
	}

	for (const trackScope of dkt.readMany(projectScope, 'tracks')) {
		for (const clipScope of dkt.readMany(trackScope, 'clips')) {
			if (dkt.readAttrs(clipScope, ['sourceClipId']).sourceClipId === clipId) {
				return clipScope
			}
		}
	}

	return null
}

/** Find text scope by traversing clips and their text child. */
const findTextScope = (env: EditorActionEnvironment, textId: string): ReactSyncScopeHandle | null => {
	const dkt = env.dkt
	if (!dkt) {
		return null
	}

	const rootScope = dkt.getRootScope()
	if (!rootScope) {
		return null
	}

	const projectScope = dkt.readOne(rootScope, 'activeProject')
	if (!projectScope) {
		return null
	}

	for (const trackScope of dkt.readMany(projectScope, 'tracks')) {
		for (const clipScope of dkt.readMany(trackScope, 'clips')) {
			const textScope = dkt.readOne(clipScope, 'text')
			if (textScope && dkt.readAttrs(textScope, ['sourceTextId']).sourceTextId === textId) {
				return textScope
			}
		}
	}

	return null
}

/** Find effect scope by traversing clips and their effects children. */
const findEffectScope = (env: EditorActionEnvironment, effectId: string): ReactSyncScopeHandle | null => {
	const dkt = env.dkt
	if (!dkt) {
		return null
	}

	const rootScope = dkt.getRootScope()
	if (!rootScope) {
		return null
	}

	const projectScope = dkt.readOne(rootScope, 'activeProject')
	if (!projectScope) {
		return null
	}

	for (const trackScope of dkt.readMany(projectScope, 'tracks')) {
		for (const clipScope of dkt.readMany(trackScope, 'clips')) {
			for (const effectScope of dkt.readMany(clipScope, 'effects')) {
				if (dkt.readAttrs(effectScope, ['sourceEffectId']).sourceEffectId === effectId) {
					return effectScope
				}
			}
		}
	}

	return null
}

const getSelectedEntityId = (env: EditorActionEnvironment): string | null => {
	const rootScope = env.dkt?.getRootScope()
	if (!rootScope) {
		return null
	}

	const selectedEntityId = env.dkt?.readAttrs(rootScope, ['selectedEntityId']).selectedEntityId
	return typeof selectedEntityId === 'string' && selectedEntityId ? selectedEntityId : null
}

const getCursor = (env: EditorActionEnvironment): number => {
	const rootScope = env.dkt?.getRootScope()
	if (!rootScope) {
		return 0
	}

	const cursor = env.dkt?.readAttrs(rootScope, ['cursor']).cursor
	return typeof cursor === 'number' ? cursor : 0
}

const dispatchClipAction = (env: EditorActionEnvironment, clipId: string, actionName: string, payload: unknown): void => {
	const scope = findClipScope(env, clipId)
	if (scope) {
		env.dkt?.dispatch(actionName, payload, scope)
	}
}

export const createDktActionRuntime = (
	env: EditorActionEnvironment,
	options: CreateDktActionRuntimeOptions,
): VideoEditorHarnessActions => {
	const sessionRootActions = createSessionRootActions(env, options)
	const exportActions = createExportActions(env)
	const mediaImportActions = createMediaImportActions(env, options, () => actions)

	const actions: VideoEditorHarnessActions = {
		...sessionRootActions,
		...exportActions,
		...mediaImportActions,

		updateSelectedText(): void {
		},

		renameClipById(clipId: string, name: string): void {
			dispatchClipAction(env, clipId, 'rename', { name })
		},

		renameSelectedClip(name: string): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.renameClipById(clipId, name)
			}
		},

		colorClipById(clipId: string, color: string): void {
			dispatchClipAction(env, clipId, 'color', { color })
		},

		colorSelectedClip(color: string): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.colorClipById(clipId, color)
			}
		},

		updateClipOpacityById(clipId: string, opacityPercent: number): void {
			dispatchClipAction(env, clipId, 'updateOpacity', { opacityPercent })
		},

		updateSelectedClipOpacity(opacityPercent: number): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipOpacityById(clipId, opacityPercent)
			}
		},

		updateClipFadeById(clipId: string, edge: 'in' | 'out', delta: number): void {
			dispatchClipAction(env, clipId, 'setFade', { edge, delta })
		},

		updateSelectedClipFade(edge: 'in' | 'out', delta: number): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipFadeById(clipId, edge, delta)
			}
		},

		updateClipTransformById(clipId: string, partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			dispatchClipAction(env, clipId, 'setTransform', partial)
		},

		updateSelectedClipTransform(partial: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipTransformById(clipId, partial)
			}
		},

		updateClipAudioById(clipId: string, partial: Partial<Record<'gain' | 'pan', number>>): void {
			dispatchClipAction(env, clipId, 'setAudio', partial)
		},

		updateSelectedClipAudio(partial: Partial<Record<'gain' | 'pan', number>>): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.updateClipAudioById(clipId, partial)
			}
		},

		trimClipById(clipId: string, edge: 'start' | 'end', delta: number): void {
			dispatchClipAction(env, clipId, 'trim', { edge, delta })
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

			dispatchClipAction(env, clipId, 'resize', { edge, delta })
		},

		addEffectToClip(clipId: string, kind: 'blur' | 'sharpen' | 'tint'): void {
			dispatchClipAction(env, clipId, 'addEffect', { kind })
		},

		addEffectToSelectedClip(kind: 'blur' | 'sharpen' | 'tint'): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.addEffectToClip(clipId, kind)
			}
		},

		addColorCorrectionToClip(clipId: string): void {
			dispatchClipAction(env, clipId, 'addEffect', { kind: 'tint' })
		},

		addColorCorrectionToSelectedClip(): void {
			const clipId = getSelectedEntityId(env)
			if (clipId) {
				actions.addColorCorrectionToClip(clipId)
			}
		},

		updateTextById(textId: string, attrs: Partial<TextAttrs>): void {
			const scope = findTextScope(env, textId)
			if (!scope) {
				return
			}

			if ('content' in attrs) {
				env.dkt?.dispatch('setTextContent', { content: attrs.content }, scope)
			}
			if ('style' in attrs) {
				env.dkt?.dispatch('setTextStyle', { style: attrs.style }, scope)
			}
			if ('box' in attrs) {
				env.dkt?.dispatch('setTextBox', { box: attrs.box }, scope)
			}
		},

		updateEffectAttrs(effectId: string, attrs: Partial<EffectAttrs>): void {
			const scope = findEffectScope(env, effectId)
			if (!scope) {
				return
			}

			if ('name' in attrs) {
				env.dkt?.dispatch('setEffectName', { name: attrs.name }, scope)
			}
			if ('kind' in attrs) {
				env.dkt?.dispatch('setEffectKind', { kind: attrs.kind }, scope)
			}
			if ('enabled' in attrs) {
				env.dkt?.dispatch('setEffectEnabled', { enabled: attrs.enabled }, scope)
			}
			if ('amount' in attrs) {
				env.dkt?.dispatch('setEffectAmount', { amount: attrs.amount }, scope)
			}
			if ('params' in attrs) {
				env.dkt?.dispatch('setEffectParams', { params: attrs.params }, scope)
			}
			if ('color' in attrs) {
				env.dkt?.dispatch('setEffectColor', { color: attrs.color }, scope)
			}
		},

		deleteClipById(clipId: string): void {
			// Soft delete: collapse duration to 0
			dispatchClipAction(env, clipId, 'setTimelineAttrs', { duration: 0 })
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

			dispatchClipAction(env, clipId, 'splitAt', { time: roundToHundredths(getCursor(env)) })
		},

		splitClipByIdAt(clipId: string, time: number): void {
			dispatchClipAction(env, clipId, 'splitAt', { time: roundToHundredths(time) })
		},

		removeEffectFromClip(clipId: string, effectId: string): void {
			dispatchClipAction(env, clipId, 'removeEffect', { effectId })
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

			dispatchClipAction(env, clipId, 'moveBy', { delta })
		},
	}

	return actions
}


