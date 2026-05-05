import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EditorActionScope } from '../domain/actionScope'
import { ROOT_ACTION_SCOPE } from '../domain/actionScope'
import { CMD, type EditorSessionState } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateLegendActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import { executeActionBuildResult } from './actionTransactionExecutor'
import { commandStep, createdIdRef } from '../domain/actionTransactions'
import { type DktSessionActionName, reduceDktSessionAction } from '../dkt/sessionActions'

export type ScopedCommandDispatcher = <Name extends EditorActionName>(
	scope: EditorActionScope,
	name: Name,
	payload: EditorActionPayload<Name>,
) => void

const applySessionRootPatch = (env: EditorActionEnvironment, patch: Record<string, unknown>): void => {
	if ('activeProjectId' in patch) {
		env.session.setActiveProject(typeof patch.activeProjectId === 'string' ? patch.activeProjectId : null)
	}
	if ('selectedEntityId' in patch) {
		env.session.selectEntity((patch.selectedEntityId as string | null | undefined) ?? null)
	}
	if ('cursor' in patch && typeof patch.cursor === 'number' && Number.isFinite(patch.cursor)) {
		env.session.setCursor(Math.max(0, patch.cursor))
	}
	if ('isPlaying' in patch && typeof patch.isPlaying === 'boolean') {
		env.session.setPlaying(patch.isPlaying)
	}
	if ('timelineZoom' in patch && typeof patch.timelineZoom === 'number' && Number.isFinite(patch.timelineZoom)) {
		env.session.setTimelineZoom(patch.timelineZoom)
	}
}

const dispatchDktSessionAction = (
	env: EditorActionEnvironment,
	actionName: DktSessionActionName,
	payload?: unknown,
): void => {
	const dispatch = env.dkt?.dispatchSessionAction
	if (!dispatch) {
		return
	}

	void Promise.resolve(dispatch(actionName, payload)).catch(() => undefined)
}

const applyDktSessionAction = (
	env: EditorActionEnvironment,
	actionName: DktSessionActionName,
	payload?: unknown,
): void => {
	const patch = reduceDktSessionAction(actionName, payload, env.session.get())
	if (!patch) {
		return
	}

	dispatchDktSessionAction(env, actionName, payload)
	applySessionRootPatch(env, patch)
}

export const createSessionRootActions = (
	env: EditorActionEnvironment,
	options: CreateLegendActionRuntimeOptions,
	dispatchBuiltCommand: ScopedCommandDispatcher,
): Pick<VideoEditorHarnessActions,
	| 'createProject'
	| 'setActiveProject'
	| 'undo'
	| 'redo'
	| 'addTrack'
	| 'selectEntity'
	| 'setActiveInspectorTab'
	| 'togglePlayback'
	| 'setCursor'
	| 'tickPlayback'
	| 'zoomTimeline'
> => ({
	createProject(title?: string): void {
		void executeActionBuildResult(env, {
			type: 'transaction',
			steps: [
				commandStep(
					{ c: CMD.PROJECT_CREATE, p: { title } },
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
		}, {
			applySessionPatch: (patch) => applySessionRootPatch(env, patch),
		})
	},

	setActiveProject(projectId: string): void {
		const projectNode = env.stores.getRegistry().entitiesById[projectId]
		if (!projectNode || projectNode.type !== 'project') {
			return
		}

		env.stores.projects$.activeProjectId.set(projectId)
		applyDktSessionAction(env, 'setActiveProject', projectId)
	},

	undo(): void {
		return
	},

	redo(): void {
		return
	},

	addTrack(kind: 'video' | 'audio'): void {
		dispatchBuiltCommand(ROOT_ACTION_SCOPE, 'addTrack', { kind })
	},

	selectEntity(entityId: string | null): void {
		applyDktSessionAction(env, 'selectEntity', entityId)
	},

	setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void {
		env.session.setActiveInspectorTab(tab)
	},

	togglePlayback(): void {
		applyDktSessionAction(env, 'togglePlayback')
	},

	setCursor(value: number): void {
		applyDktSessionAction(env, 'setCursor', value)
	},

	tickPlayback(deltaSeconds: number): void {
		const session = env.session.get()
		if (!session.isPlaying) {
			return
		}

		const duration = options.playbackDuration$.get()
		if (!Number.isFinite(duration) || duration <= 0) {
			return
		}

		env.session.setCursor((session.cursor + deltaSeconds) % duration)
	},

	zoomTimeline(delta: number): void {
		applyDktSessionAction(env, 'zoomTimeline', delta)
	},
})
