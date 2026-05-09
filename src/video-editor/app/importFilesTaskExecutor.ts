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
	const inputBatchHandleId = task.payload.inputBatchHandleId
	if (typeof inputBatchHandleId !== 'string' || !inputBatchHandleId) {
		return
	}

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

	try {
		for (const file of fileList) {
			const kind = env.media.getFileKind(file)
			if (!kind) continue

			const objectUrl = env.media.createObjectUrl(file)
			if (!objectUrl) continue
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
		}
		env.tasks.completeTask(task)
	} catch {
		env.tasks.failTask(task)
	}
}
