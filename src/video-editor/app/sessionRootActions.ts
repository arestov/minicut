import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { CreateDktActionRuntimeOptions, VideoEditorHarnessActions } from './actionRuntimeTypes'
import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'

let projectCreationSequence = 0

const getRootScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null =>
	env.dkt?.getRootScope() ?? null

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
		const rootScope = getRootScope(env)
		if (!rootScope) {
			return
		}

		projectCreationSequence += 1
		const projectTitle = typeof title === 'string' && title ? title : 'Untitled project'
		env.dkt?.dispatch('createProject', { title: projectTitle }, rootScope)
	},

	setActiveProject(projectId: string): void {
		const rootScope = getRootScope(env)
		if (!rootScope) {
			return
		}

		env.dkt?.dispatch('setActiveProject', projectId, rootScope)
	},

	addTrack(kind: 'video' | 'audio'): void {
		const rootScope = getRootScope(env)
		if (!rootScope || !env.dkt) {
			return
		}

		const projectScope = env.dkt.readOne(rootScope, 'activeProject')
		if (!projectScope) {
			return
		}

		env.dkt.dispatch('addTrack', {
			kind,
			name: kind === 'audio' ? 'Audio Track' : 'Video Track',
			height: kind === 'audio' ? 72 : 84,
		}, projectScope)
	},

	selectEntity(entityId: string | null): void {
		const rootScope = getRootScope(env)
		if (!rootScope) {
			return
		}

		env.dkt?.dispatch('selectEntity', entityId, rootScope)
	},

	setActiveInspectorTab(tab): void {
		const rootScope = getRootScope(env)
		if (!rootScope) {
			return
		}

		env.dkt?.dispatch('setActiveInspectorTab', tab, rootScope)
	},

	togglePlayback(): void {
		const rootScope = getRootScope(env)
		if (!rootScope) {
			return
		}

		env.dkt?.dispatch('togglePlayback', undefined, rootScope)
	},

	setCursor(value: number): void {
		const rootScope = getRootScope(env)
		if (!rootScope) {
			return
		}

		env.dkt?.dispatch('setCursor', value, rootScope)
	},

	tickPlayback(deltaSeconds: number): void {
		const rootScope = getRootScope(env)
		if (!rootScope || !env.dkt) {
			return
		}

		const attrs = env.dkt.readAttrs(rootScope, ['isPlaying', 'cursor'])
		if (!attrs.isPlaying) {
			return
		}

		const duration = options.playbackDuration$?.get() ?? Infinity
		if (!Number.isFinite(duration) || duration <= 0) {
			return
		}

		const cursor = typeof attrs.cursor === 'number' ? attrs.cursor : 0
		const newCursor = (cursor + deltaSeconds) % duration
		env.dkt.dispatch('setCursor', newCursor, rootScope)
	},

	zoomTimeline(delta: number): void {
		const rootScope = getRootScope(env)
		if (!rootScope) {
			return
		}

		env.dkt?.dispatch('zoomTimeline', delta, rootScope)
	},
})
