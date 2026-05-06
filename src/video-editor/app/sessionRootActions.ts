import type { EditorSessionState } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import {
	type DktSessionActionName,
	reduceSessionSelectEntityAction,
	reduceSessionSetActiveProjectAction,
	reduceSessionSetCursorAction,
	reduceSessionTogglePlaybackAction,
	reduceSessionZoomTimelineAction,
} from '../models/SessionRoot/actions'

let projectCreationSequence = 0

const createDktSourceId = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`

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

const applySessionRootPatch = (env: EditorActionEnvironment, patch: Record<string, unknown>, options: { syncDkt?: boolean } = {}): void => {
	if ('activeProjectId' in patch) {
		const activeProjectId = typeof patch.activeProjectId === 'string' ? patch.activeProjectId : null
		env.session.setActiveProject(activeProjectId)
		if (options.syncDkt) {
			dispatchDktSessionAction(env, 'setActiveProject', activeProjectId)
		}
	}
	if ('selectedEntityId' in patch) {
		const selectedEntityId = (patch.selectedEntityId as string | null | undefined) ?? null
		env.session.selectEntity(selectedEntityId)
		if (options.syncDkt && !('activeProjectId' in patch)) {
			dispatchDktSessionAction(env, 'selectEntity', selectedEntityId)
		}
	}
	if ('cursor' in patch && typeof patch.cursor === 'number' && Number.isFinite(patch.cursor)) {
		const cursor = Math.max(0, patch.cursor)
		env.session.setCursor(cursor)
		if (options.syncDkt && !('activeProjectId' in patch)) {
			dispatchDktSessionAction(env, 'setCursor', cursor)
		}
	}
	if ('isPlaying' in patch && typeof patch.isPlaying === 'boolean') {
		env.session.setPlaying(patch.isPlaying)
	}
	if ('timelineZoom' in patch && typeof patch.timelineZoom === 'number' && Number.isFinite(patch.timelineZoom)) {
		env.session.setTimelineZoom(patch.timelineZoom)
	}
}

const dispatchAndApplySessionPatch = (
	env: EditorActionEnvironment,
	actionName: DktSessionActionName,
	patch: Record<string, unknown> | null,
	payload?: unknown,
): void => {
	if (!patch) {
		return
	}

	dispatchDktSessionAction(env, actionName, payload)
	applySessionRootPatch(env, patch)
}

export const createSessionRootActions = (
	env: EditorActionEnvironment,
	options: CreateDktActionRuntimeOptions,
): Pick<VideoEditorHarnessActions,
	| 'createProject'
	| 'setActiveProject'
	| 'addTrack'
	| 'selectEntity'
	| 'setActiveInspectorTab'
	| 'togglePlayback'
	| 'setCursor'
	| 'tickPlayback'
	| 'zoomTimeline'
> => ({
	createProject(title?: string): void {
		projectCreationSequence += 1
		const projectId = createDktSourceId(`project:${projectCreationSequence}`)
		const projectTitle = typeof title === 'string' && title ? title : 'Untitled project'
		dispatchDktSessionAction(env, 'createProject', {
			sourceProjectId: projectId,
			title: projectTitle,
		})
		applySessionRootPatch(env, { activeProjectId: projectId, selectedEntityId: null, cursor: 0 })
	},

	setActiveProject(projectId: string): void {
		dispatchAndApplySessionPatch(env, 'setActiveProject', reduceSessionSetActiveProjectAction(projectId), projectId)
	},

	addTrack(kind: 'video' | 'audio'): void {
		const projectId = env.session.get().activeProjectId
		if (typeof projectId !== 'string' || !projectId) {
			return
		}

		void Promise.resolve(env.dkt?.dispatchProjectAction({ sourceProjectId: projectId }, 'addTrack', {
			sourceTrackId: createDktSourceId(`track:${projectCreationSequence}`),
			kind,
			name: kind === 'audio' ? 'Audio Track' : 'Video Track',
			height: kind === 'audio' ? 72 : 84,
		})).catch(() => undefined)
	},

	selectEntity(entityId: string | null): void {
		dispatchAndApplySessionPatch(env, 'selectEntity', reduceSessionSelectEntityAction(entityId), entityId)
	},

	setActiveInspectorTab(tab: EditorSessionState['activeInspectorTab']): void {
		env.session.setActiveInspectorTab(tab)
	},

	togglePlayback(): void {
		dispatchAndApplySessionPatch(env, 'togglePlayback', reduceSessionTogglePlaybackAction(env.session.get()))
	},

	setCursor(value: number): void {
		dispatchAndApplySessionPatch(env, 'setCursor', reduceSessionSetCursorAction(value), value)
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
		dispatchAndApplySessionPatch(env, 'zoomTimeline', reduceSessionZoomTimelineAction(delta, env.session.get()), delta)
	},
})
