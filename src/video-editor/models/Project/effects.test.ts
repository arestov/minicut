import { describe, expect, it } from 'vitest'
import { createExportBlobUrlEffectPayload, createProjectImportFilesEffectPayload, EXPORT_BLOB_URL_FX, isProjectImportFilesEffectData, PROJECT_IMPORT_FILES_FX } from './effects'
import { createRuntimeTaskFacade } from '../../app/runtimeTaskFacade'

describe('Project model effects', () => {
	it('keeps import file handles behind runtime refs', () => {
		const file = new File(['video'], 'clip.webm', { type: 'video/webm' })
		const payload = createProjectImportFilesEffectPayload([file], { projectId: 'project:1' })
		const tasks = createRuntimeTaskFacade()
		const task = tasks.dispatchTask(PROJECT_IMPORT_FILES_FX, payload)

		expect(task.payload.data).toEqual({ projectId: 'project:1', addToTimelineWhenEmpty: true })
		expect(isProjectImportFilesEffectData(task.payload.data)).toBe(true)
		expect(tasks.consumeRuntimeRef(String(task.payload.runtimeHandleId))).toEqual([file])
	})

	it('keeps export blob handles behind runtime refs', () => {
		const blob = new Blob(['webm'], { type: 'video/webm' })
		const tasks = createRuntimeTaskFacade()
		const task = tasks.dispatchTask(EXPORT_BLOB_URL_FX, createExportBlobUrlEffectPayload(blob, { projectId: 'project:1', clipId: 'clip:1' }))

		expect(task.payload.data).toEqual({ projectId: 'project:1', clipId: 'clip:1' })
		expect(tasks.consumeRuntimeRef(String(task.payload.runtimeHandleId))).toBe(blob)
	})
})
