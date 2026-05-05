import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EditorActionScope } from '../domain/actionScope'
import { ROOT_ACTION_SCOPE } from '../domain/actionScope'
import { CMD, type EditorSessionState } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateLegendActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import { executeActionBuildResult } from './actionTransactionExecutor'
import { commandStep, createdIdRef } from '../domain/actionTransactions'

export type ScopedCommandDispatcher = <Name extends EditorActionName>(
	scope: EditorActionScope,
	name: Name,
	payload: EditorActionPayload<Name>,
) => void

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

const applySessionRootPatch = (env: EditorActionEnvironment, patch: Record<string, unknown>): void => {
	if ('activeProjectId' in patch && typeof patch.activeProjectId === 'string') {
		env.session.setActiveProject(patch.activeProjectId)
	}
	if ('selectedEntityId' in patch) {
		env.session.selectEntity((patch.selectedEntityId as string | null | undefined) ?? null)
	}
	if ('cursor' in patch && typeof patch.cursor === 'number' && Number.isFinite(patch.cursor)) {
		env.session.setCursor(Math.max(0, patch.cursor))
	}
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
		applySessionRootPatch(env, {
			activeProjectId: projectId,
			selectedEntityId: null,
			cursor: 0,
		})
	},

	undo(): void {
		Promise.resolve(env.authority.undo()).finally(env.authority.syncHistoryState)
	},

	redo(): void {
		Promise.resolve(env.authority.redo()).finally(env.authority.syncHistoryState)
	},

	addTrack(kind: 'video' | 'audio'): void {
		dispatchBuiltCommand(ROOT_ACTION_SCOPE, 'addTrack', { kind })
	},

	selectEntity(entityId: string | null): void {
		env.session.selectEntity(entityId)
	},

	setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void {
		env.session.setActiveInspectorTab(tab)
	},

	togglePlayback(): void {
		env.session.setPlaying(!env.session.get().isPlaying)
	},

	setCursor(value: number): void {
		if (!Number.isFinite(value)) {
			return
		}

		env.session.setCursor(Math.max(0, roundToHundredths(value)))
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
		const current = env.session.get().timelineZoom
		env.session.setTimelineZoom(clamp(current + delta, 8, 96))
	},
})
