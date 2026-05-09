import type { DispatchRuntimeTaskPayload } from '../../app/runtimeTaskFacade'

export const PROJECT_IMPORT_FILES_FX = '$fx_handleInputFiles' as const
export const PROJECT_RENDER_EXPORT_FX = '$fx_renderExport' as const
export const EXPORT_BLOB_URL_FX = '$fx_exportBlobUrl' as const

export type ProjectImportFilesEffectData = {
	projectId: string
	inputBatchHandleId: string
	addToTimelineWhenEmpty?: boolean
}

export type ProjectRenderExportEffectData = {
	projectId: string
	clipId?: string
	range: 'project' | 'clip'
	format: 'video-webm'
}

export type ExportBlobUrlEffectData = {
	projectId: string
	clipId?: string
}

export const createProjectImportFilesEffectPayload = (
	data: ProjectImportFilesEffectData,
): DispatchRuntimeTaskPayload => ({
	data: {
		projectId: data.projectId,
		inputBatchHandleId: data.inputBatchHandleId,
		addToTimelineWhenEmpty: data.addToTimelineWhenEmpty !== false,
	},
})

export const isProjectImportFilesEffectData = (value: unknown): value is ProjectImportFilesEffectData => {
	const data = value as Partial<ProjectImportFilesEffectData> | null
	return Boolean(data && typeof data.projectId === 'string' && typeof data.inputBatchHandleId === 'string')
}

export const createExportBlobUrlEffectPayload = (
	blob: Blob,
	data: ExportBlobUrlEffectData,
): DispatchRuntimeTaskPayload => ({
	runtimeRef: blob,
	data,
})

export const createProjectRenderExportEffectData = (data: ProjectRenderExportEffectData): ProjectRenderExportEffectData => data
