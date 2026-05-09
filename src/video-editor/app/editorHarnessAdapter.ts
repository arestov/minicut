import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { VideoEditorHarnessActions } from './actionRuntimeTypes'

let exportSequence = 0

const createSourceId = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`

const getRootScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => env.pageRuntime?.getRootScope() ?? null

const getRootNodeId = (env: EditorActionEnvironment): string | null => {
	const rootScope = getRootScope(env) as { _node_id?: unknown } | null
	return typeof rootScope?._node_id === 'string' ? rootScope._node_id : null
}

const dispatchRoot = (env: EditorActionEnvironment, actionName: string, payload?: unknown): void => {
	env.dkt?.dispatch(actionName, payload, getRootScope(env))
}

export const createEditorHarnessAdapter = (
	env: EditorActionEnvironment,
): VideoEditorHarnessActions => {
	return ({
		createProject(title?: string): void {
			dispatchRoot(env, 'createProject', typeof title === 'string' && title ? { title } : undefined)
		},
		setActiveProject(projectId: string): void {
			dispatchRoot(env, 'setActiveProject', projectId)
		},
		addTextClip(content?: string): void {
			const sourceTextId = createSourceId('text')
			const sourceClipId = createSourceId('clip')
			dispatchRoot(env, 'addTextClipToTimeline', {
				sourceClipId,
				sourceTextId,
				name: 'Text',
				mediaKind: 'text',
				start: 0,
				in: 0,
				duration: 3,
				text: {
					sourceTextId,
					content: typeof content === 'string' && content ? content : 'Text',
				},
			})
		},
		requestSelectedClipExport(): void {
			dispatchRoot(env, 'requestSelectedClipExport', {
				id: `export:${Date.now().toString(36)}:${++exportSequence}`,
				initiatedBy: getRootNodeId(env),
			})
		},
		requestProjectExport(): void {
			dispatchRoot(env, 'requestProjectExport', {
				id: `export:${Date.now().toString(36)}:${++exportSequence}`,
				initiatedBy: getRootNodeId(env),
			})
		},
		getCachedExportUrl(exportId: string): string | null {
			const cached = env.export.cachedResults.get(exportId)
			return cached?.downloadUrl ?? null
		},
		setCursor(value: number): void {
			dispatchRoot(env, 'setCursor', value)
		},
	})
}
