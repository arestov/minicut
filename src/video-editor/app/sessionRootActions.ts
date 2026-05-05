import type { EditorActionName, EditorActionPayload } from '../domain/actionRequests'
import type { EditorActionScope } from '../domain/actionScope'
import { ROOT_ACTION_SCOPE } from '../domain/actionScope'
import { CMD, type EditorSessionState } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateLegendActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'

export type ScopedCommandDispatcher = <Name extends EditorActionName>(
	scope: EditorActionScope,
	name: Name,
	payload: EditorActionPayload<Name>,
) => void

const roundToHundredths = (value: number): number => Math.round(value * 100) / 100

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value))

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
		env.authority.dispatch({ c: CMD.PROJECT_CREATE, p: { title } }).then((result) => {
			const projectId = String(result.createdIds?.projectId)
			env.session.setActiveProject(projectId)
			env.session.selectEntity(null)
			env.session.setCursor(0)
		})
	},

	setActiveProject(projectId: string): void {
		env.stores.projects$.activeProjectId.set(projectId)
		env.session.setActiveProject(projectId)
		env.session.selectEntity(null)
		env.session.setCursor(0)
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
		env.session.setCursor(roundToHundredths(value))
	},

	tickPlayback(deltaSeconds: number): void {
		const session = env.session.get()
		if (!session.isPlaying) {
			return
		}

		env.session.setCursor((session.cursor + deltaSeconds) % options.playbackDuration$.get())
	},

	zoomTimeline(delta: number): void {
		const current = env.session.get().timelineZoom
		env.session.setTimelineZoom(clamp(current + delta, 8, 96))
	},
})
