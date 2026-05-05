import { getActiveProject, getSelectedClip } from '../domain/selectors'
import type { ProjectRegistry, ResourceAttrs } from '../domain/types'
import type { EditorActionEnvironment } from './editorActionEnvironment'
import type { VideoEditorHarnessActions } from './actionRuntimeTypes'

const asResourceAttrs = (attrs: Record<string, unknown>): ResourceAttrs => attrs as unknown as ResourceAttrs

export const createExportRegistrySnapshot = (env: EditorActionEnvironment, registry: ProjectRegistry): ProjectRegistry => {
	const snapshot = structuredClone(registry)
	for (const [resourceId, entity] of Object.entries(snapshot.entitiesById)) {
		if (!entity || entity.type !== 'resource') {
			continue
		}

		const attrs = asResourceAttrs(entity.attrs)
		const transfer = env.transfers.manager.getTransfer(resourceId)
		if (!transfer || transfer.status !== 'ready') {
			continue
		}

		const resolvedUrl = env.transfers.resolveResourceUrl(resourceId, attrs.url)
		if (!resolvedUrl) {
			continue
		}

		entity.attrs = {
				...attrs,
				url: resolvedUrl,
				status: 'ready',
				data: {
					...attrs.data,
					status: 'ready',
					loadedBytes: transfer.loadedBytes,
					ranges: {
						...attrs.data.ranges,
						loaded: transfer.loadedRanges,
						requested: transfer.requestedRanges,
					},
				},
		}
	}

	return snapshot
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

		const result = await env.export.render({ registry: createExportRegistrySnapshot(env, registry), projectId: project.id, range: { type: 'clip', clipId }, format: 'video-webm' }, onProgress)
		const blobTask = env.tasks.dispatchTask('$fx_exportBlobUrl', {
			runtimeRef: result.blob,
			data: { projectId: project.id, clipId },
		}, {
			queuePolicy: 'queue-all',
			intentKey: '$fx_exportBlobUrl:clip',
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

		const result = await env.export.render({ registry: createExportRegistrySnapshot(env, registry), projectId: project.id, range: { type: 'project' }, format: 'video-webm' }, onProgress)
		const blobTask = env.tasks.dispatchTask('$fx_exportBlobUrl', {
			runtimeRef: result.blob,
			data: { projectId: project.id },
		}, {
			queuePolicy: 'queue-all',
			intentKey: '$fx_exportBlobUrl:project',
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
