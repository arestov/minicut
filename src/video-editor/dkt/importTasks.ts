import type { DispatchRuntimeTaskPayload } from '../app/runtimeTaskFacade'

export const DKT_IMPORT_FILES_FX = '$fx_handleInputFiles' as const

export type DktImportFilesTaskData = {
	projectId: string
	addToTimelineWhenEmpty?: boolean
}

export const createDktImportFilesTaskPayload = (
	files: FileList | File[],
	data: DktImportFilesTaskData,
): DispatchRuntimeTaskPayload => ({
	runtimeRef: Array.from(files),
	data: {
		projectId: data.projectId,
		addToTimelineWhenEmpty: data.addToTimelineWhenEmpty !== false,
	},
})

export const isDktImportFilesTaskData = (value: unknown): value is DktImportFilesTaskData => {
	const data = value as Partial<DktImportFilesTaskData> | null
	return Boolean(data && typeof data.projectId === 'string')
}
