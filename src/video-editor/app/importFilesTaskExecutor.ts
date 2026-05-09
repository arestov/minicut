import type { ReactSyncScopeHandle } from '../../dkt-react-sync/scope/ScopeHandle'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { RuntimeTaskDescriptor } from './runtimeTaskFacade'

const createSourceId = (prefix: string): string => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`

const isFileLike = (value: unknown): value is File =>
	Boolean(
		value
		&& typeof value === 'object'
		&& typeof (value as { name?: unknown }).name === 'string'
		&& typeof (value as { size?: unknown }).size === 'number',
	)

const getActiveProjectScope = (env: EditorActionEnvironment): ReactSyncScopeHandle | null => {
	const pageRuntime = env.pageRuntime
	if (!pageRuntime) {
		return null
	}
	const rootScope = pageRuntime.getRootScope()
	if (!rootScope) {
		return null
	}
	return pageRuntime.readOne(rootScope, 'activeProject')
}

const getImportPayload = (task: RuntimeTaskDescriptor): { inputBatchHandleId: string } | null => {
	const data = task.payload.data as { inputBatchHandleId?: unknown } | null
	return typeof data?.inputBatchHandleId === 'string' && data.inputBatchHandleId
		? { inputBatchHandleId: data.inputBatchHandleId }
		: null
}

const dispatchImportProgress = (
	env: EditorActionEnvironment,
	projectScope: ReactSyncScopeHandle,
	payload: { taskId: string; stage: 'processing' | 'done' | 'error'; processed: number; total: number; error?: string },
): void => {
	env.dkt?.dispatch('setImportProgress', payload, projectScope)
}

export const executeImportFilesTask = async ({
	task,
	env,
}: {
	task: RuntimeTaskDescriptor
	env: EditorActionEnvironment
}): Promise<void> => {
	if (task.dropped) {
		return
	}
	const importPayload = getImportPayload(task)
	if (!importPayload) {
		return
	}
	const { inputBatchHandleId } = importPayload

	const raw = env.tasks.consumeRuntimeRef(inputBatchHandleId)
	const fileList = Array.isArray(raw) ? raw.filter(isFileLike) : []
	if (fileList.length === 0) {
		env.tasks.completeTask(task)
		return
	}

	const projectScope = getActiveProjectScope(env)
	if (!projectScope || !env.dkt) {
		env.tasks.completeTask(task)
		return
	}

	const ownerPeerId = env.transfers.getPeerId()
	let processed = 0

	try {
		dispatchImportProgress(env, projectScope, {
			taskId: inputBatchHandleId,
			stage: 'processing',
			processed,
			total: fileList.length,
		})
		for (const file of fileList) {
			const kind = env.media.getFileKind(file)
			if (!kind) {
				processed += 1
				dispatchImportProgress(env, projectScope, {
					taskId: inputBatchHandleId,
					stage: 'processing',
					processed,
					total: fileList.length,
				})
				continue
			}

			const objectUrl = env.media.createObjectUrl(file)
			if (!objectUrl) {
				processed += 1
				dispatchImportProgress(env, projectScope, {
					taskId: inputBatchHandleId,
					stage: 'processing',
					processed,
					total: fileList.length,
				})
				continue
			}
			env.lifecycle.registerObjectUrl(objectUrl, 'import')

			let duration = 0
			try {
				duration = await env.media.getImportedResourceDuration(objectUrl, kind)
			} catch {
				duration = 0
			}

			const sourceResourceId = createSourceId('resource')
			const mime = file.type || 'application/octet-stream'

			env.dkt.dispatch('importResource', {
				sourceResourceId,
				name: file.name,
				kind,
				url: objectUrl,
				mime,
				duration,
				size: file.size,
				source: {
					kind: 'local',
					ownerPeerId: typeof ownerPeerId === 'string' && ownerPeerId.length > 0 ? ownerPeerId : null,
				},
				status: 'ready',
				data: {
					status: 'ready',
					chunkSize: env.resourceChunkSize,
					chunks: {},
					ranges: { loaded: [[0, file.size]], requested: [] },
					loadedBytes: file.size,
				},
			}, projectScope)
			await env.pageRuntime?.waitForRuntimeSettled?.()

			env.transfers.manager.registerLocalResource(sourceResourceId, file, {
				objectUrl,
				kind,
				mime,
				duration,
				size: file.size,
				chunkSize: env.resourceChunkSize,
				ownerPeerId,
				sourceKind: 'local',
				fallbackUrl: objectUrl,
				name: file.name,
			})
			processed += 1
			dispatchImportProgress(env, projectScope, {
				taskId: inputBatchHandleId,
				stage: 'processing',
				processed,
				total: fileList.length,
			})
		}
		dispatchImportProgress(env, projectScope, {
			taskId: inputBatchHandleId,
			stage: 'done',
			processed,
			total: fileList.length,
		})
		env.tasks.completeTask(task)
	} catch (error) {
		dispatchImportProgress(env, projectScope, {
			taskId: inputBatchHandleId,
			stage: 'error',
			processed,
			total: fileList.length,
			error: error instanceof Error ? error.message : String(error),
		})
		env.tasks.failTask(task)
	}
}
