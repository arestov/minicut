import { describe, expect, it } from 'vitest'
import { createRuntimeTaskFacade } from '../app/runtimeTaskFacade'
import { createDktImportFilesTaskPayload, DKT_IMPORT_FILES_FX, isDktImportFilesTaskData } from './importTasks'

describe('DKT import tasks', () => {
	it('wraps files as a runtimeRef and keeps graph data serializable', () => {
		const file = new File(['video'], 'clip.webm', { type: 'video/webm' })
		const payload = createDktImportFilesTaskPayload([file], { projectId: 'project:1' })
		const tasks = createRuntimeTaskFacade()
		const task = tasks.dispatchTask(DKT_IMPORT_FILES_FX, payload)

		expect(task.payload.runtimeRefId).toBeDefined()
		expect(task.payload.data).toEqual({ projectId: 'project:1', addToTimelineWhenEmpty: true })
		expect(isDktImportFilesTaskData(task.payload.data)).toBe(true)
		expect(tasks.consumeRuntimeRef(String(task.payload.runtimeRefId))).toEqual([file])
	})
})
