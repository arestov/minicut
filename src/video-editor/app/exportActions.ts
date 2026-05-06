import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { VideoEditorHarnessActions } from './actionRuntimeTypes'
import { createExportBlobUrlEffectPayload, createProjectRenderExportEffectData, EXPORT_BLOB_URL_FX, PROJECT_RENDER_EXPORT_FX } from '../models/Project/effects'
import type { ExportProgressEvent, ExportRenderResult } from '../render/exportRenderer'

const getActiveProjectId = (env: EditorActionEnvironment): string | null => {
	const rootScope = env.dkt?.getRootScope()
	if (!rootScope) {
		return null
	}

	const projectScope = env.dkt?.readOne(rootScope, 'activeProject')
	if (!projectScope) {
		return null
	}

	const sourceProjectId = env.dkt?.readAttrs(projectScope, ['sourceProjectId']).sourceProjectId
	return typeof sourceProjectId === 'string' && sourceProjectId ? sourceProjectId : null
}

const getSelectedClipId = (env: EditorActionEnvironment): string | null => {
	const rootScope = env.dkt?.getRootScope()
	if (!rootScope) {
		return null
	}

	const selectedEntityId = env.dkt?.readAttrs(rootScope, ['selectedEntityId']).selectedEntityId
	return typeof selectedEntityId === 'string' && selectedEntityId ? selectedEntityId : null
}

const dispatchRenderExportTask = (env: EditorActionEnvironment, projectId: string, range: 'project' | 'clip', clipId?: string): void => {
	const task = env.tasks.dispatchTask(PROJECT_RENDER_EXPORT_FX, {
		data: createProjectRenderExportEffectData({
			projectId,
			clipId,
			range,
			format: 'video-webm',
		}),
	}, {
		queuePolicy: 'queue-all',
		intentKey: `${PROJECT_RENDER_EXPORT_FX}:${range}`,
	})
	env.tasks.completeTask(task)
}

const registerExportBlob = (env: EditorActionEnvironment, result: ExportRenderResult, projectId: string, clipId?: string): ExportRenderResult => {
	const blobTask = env.tasks.dispatchTask(EXPORT_BLOB_URL_FX, createExportBlobUrlEffectPayload(result.blob, { projectId, clipId }), {
		queuePolicy: 'queue-all',
		intentKey: `${EXPORT_BLOB_URL_FX}:${clipId ? 'clip' : 'project'}`,
	})
	const runtimeBlob = blobTask.payload.runtimeRefId
		? env.tasks.consumeRuntimeRef(blobTask.payload.runtimeRefId)
		: null
	env.tasks.completeTask(blobTask)
	const downloadUrl = runtimeBlob instanceof Blob
		? env.media.createObjectUrl(runtimeBlob)
		: env.media.createObjectUrl(result.blob)
	if (downloadUrl) {
		env.lifecycle.registerObjectUrl(downloadUrl, 'export')
		return { ...result, downloadUrl }
	}

	return result
}

export const createExportActions = (
	env: EditorActionEnvironment,
): Pick<VideoEditorHarnessActions, 'queueClipExportById' | 'queueSelectedClipExport' | 'queueProjectExport'> => ({
	// TODO Phase 4: replace stub with DKT task-based renderer (no registry)
	async queueClipExportById(clipId, onProgress: ((event: ExportProgressEvent) => void) | undefined): Promise<ExportRenderResult | null> {
		const projectId = getActiveProjectId(env)
		if (!projectId) {
			return null
		}

		dispatchRenderExportTask(env, projectId, 'clip', clipId)
		return null
	},

	async queueSelectedClipExport(onProgress: ((event: ExportProgressEvent) => void) | undefined): Promise<ExportRenderResult | null> {
		const clipId = getSelectedClipId(env)
		return clipId ? this.queueClipExportById(clipId, onProgress) : null
	},

	async queueProjectExport(onProgress: ((event: ExportProgressEvent) => void) | undefined): Promise<ExportRenderResult | null> {
		const projectId = getActiveProjectId(env)
		if (!projectId) {
			return null
		}

		dispatchRenderExportTask(env, projectId, 'project')
		return null
	},
})


