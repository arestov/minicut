import { describe, expect, it } from "vitest";
import { createRuntimeTaskFacade } from "../app/runtimeTaskFacade";
import {
	createProjectImportFilesEffectPayload,
	isProjectImportFilesEffectData,
	PROJECT_IMPORT_FILES_FX,
} from "../models/Project/effects";

describe("DKT import tasks", () => {
	it("keeps graph import task data serializable", () => {
		const payload = createProjectImportFilesEffectPayload({
			projectId: "project:1",
			inputBatchHandleId: "input-batch:1",
		});
		const tasks = createRuntimeTaskFacade();
		const task = tasks.dispatchTask(PROJECT_IMPORT_FILES_FX, payload);

		expect(task.payload.runtimeHandleId).toBeUndefined();
		expect(task.payload.data).toEqual({
			projectId: "project:1",
			inputBatchHandleId: "input-batch:1",
			addToTimelineWhenEmpty: true,
		});
		expect(isProjectImportFilesEffectData(task.payload.data)).toBe(true);
	});
});
