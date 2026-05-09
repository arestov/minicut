import { describe, expect, it } from 'vitest'
import { createRuntimeTaskFacade } from '../app/runtimeTaskFacade'
import {
	PROJECT_IMPORT_FILES_FX,
	createProjectImportFilesEffectPayload,
	isProjectImportFilesEffectData,
} from '../models/Project/effects'

describe('DKT import tasks', () => {
	it('wraps files as a runtimeRef and keeps graph data serializable', () => {
		const file = new File(['video'], 'clip.webm', { type: 'video/webm' })
		const payload = createProjectImportFilesEffectPayload([file], { projectId: 'project:1' })
		const tasks = createRuntimeTaskFacade()
		const task = tasks.dispatchTask(PROJECT_IMPORT_FILES_FX, payload)

		expect(task.payload.inputBatchHandleId).toBeDefined()
		expect(task.payload.data).toEqual({ projectId: 'project:1', addToTimelineWhenEmpty: true })
		expect(isProjectImportFilesEffectData(task.payload.data)).toBe(true)
		expect(tasks.consumeRuntimeRef(String(task.payload.inputBatchHandleId))).toEqual([file])
	})
})
