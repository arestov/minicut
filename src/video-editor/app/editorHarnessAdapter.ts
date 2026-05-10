import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { VideoEditorHarnessActions } from './actionRuntimeTypes'
import { executeImportFilesTask } from './importFilesTaskExecutor'
import { PROJECT_IMPORT_FILES_FX } from '../models/Project/effects'

let exportSequence = 0

const getRootScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => env.pageRuntime?.getRootScope() ?? null

const getRootNodeId = (env: EditorActionEnvironment): string | null => {
	const rootScope = getRootScope(env) as { _nodeId?: unknown } | null
	return typeof rootScope?._nodeId === 'string' ? rootScope._nodeId : null
}

const dispatchRoot = (env: EditorActionEnvironment, actionName: string, payload?: unknown): void => {
	env.dkt?.dispatch(actionName, payload, getRootScope(env))
}

const stageImportFiles = (env: EditorActionEnvironment, files: FileList | File[]): string | null => {
	const fileList = Array.from(files)
	if (fileList.length === 0) {
		return null
	}
	return env.tasks.putRuntimeRef(fileList)
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
			dispatchRoot(env, 'addTextClipToTimeline', {
				name: 'Text',
				mediaKind: 'text',
				start: 0,
				in: 0,
				duration: 3,
				text: {
					content: typeof content === 'string' && content ? content : 'Text',
				},
			})
		},
		stageImportFiles(files: FileList | File[]): string | null {
			return stageImportFiles(env, files)
		},
		importFilesIntoProject(files: FileList | File[], projectScope: ReactSyncScopeHandle): void {
			const inputBatchHandleId = stageImportFiles(env, files)
			if (!inputBatchHandleId) {
				return
			}
			const task = env.tasks.dispatchTask(PROJECT_IMPORT_FILES_FX, {
				data: {
					projectId: projectScope._nodeId,
					inputBatchHandleId,
					addToTimelineWhenEmpty: true,
				},
			}, {
				queuePolicy: 'queue-all',
				intentKey: `${PROJECT_IMPORT_FILES_FX}:${inputBatchHandleId}`,
			})
			if (task.dropped) {
				return
			}
			void executeImportFilesTask({ task, env, projectScope })
		},
		requestImportFiles(files: FileList | File[]): void {
			const inputBatchHandleId = stageImportFiles(env, files)
			if (!inputBatchHandleId) {
				return
			}
			dispatchRoot(env, 'requestImportFiles', { inputBatchHandleId })
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
