import { getActiveProject, getSelectedClip } from '../domain/selectors'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { VideoEditorHarnessActions } from './actionRuntimeTypes'
import { createExportBlobUrlEffectPayload, createProjectRenderExportEffectData, EXPORT_BLOB_URL_FX, PROJECT_RENDER_EXPORT_FX } from '../models/Project/effects'

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

export const createExportActions = (
	env: EditorActionEnvironment,
): Pick<VideoEditorHarnessActions, 'queueClipExportById' | 'queueSelectedClipExport' | 'queueProjectExport'> => ({
	async queueClipExportById(clipId, onProgress) {
		const registry = env.stores.getRegistry()
		const project = getActiveProject(registry, env.session.get())
		const clip = registry.entitiesById[clipId]
		if (!project || !clip) {
			return null
		}

		dispatchRenderExportTask(env, project.id, 'clip', clipId)
		const result = await env.export.render({ registry, projectId: project.id, range: { type: 'clip', clipId }, format: 'video-webm' }, onProgress)
		const blobTask = env.tasks.dispatchTask(EXPORT_BLOB_URL_FX, createExportBlobUrlEffectPayload(result.blob, { projectId: project.id, clipId }), {
			queuePolicy: 'queue-all',
			intentKey: `${EXPORT_BLOB_URL_FX}:clip`,
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
	},

	async queueSelectedClipExport(onProgress) {
		const clip = getSelectedClip(env.stores.getRegistry(), env.session.get())
		return clip ? this.queueClipExportById(clip.id, onProgress) : null
	},

	async queueProjectExport(onProgress) {
		const registry = env.stores.getRegistry()
		const project = getActiveProject(registry, env.session.get())
		if (!project) {
			return null
		}

		dispatchRenderExportTask(env, project.id, 'project')
		const result = await env.export.render({ registry, projectId: project.id, range: { type: 'project' }, format: 'video-webm' }, onProgress)
		const blobTask = env.tasks.dispatchTask(EXPORT_BLOB_URL_FX, createExportBlobUrlEffectPayload(result.blob, { projectId: project.id }), {
			queuePolicy: 'queue-all',
			intentKey: `${EXPORT_BLOB_URL_FX}:project`,
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
	},
})
