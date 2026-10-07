import { describe, expect, it, vi } from "vitest";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";
import type { EditorActionEnvironment } from "./editorActionEnvironment";
import { createEditorHarnessAdapter } from "./editorHarnessAdapter";
import { createRuntimeTaskFacade } from "./runtimeTaskFacade";

const scope = (id: string): ReactSyncScopeHandle => ({ kind: "scope", _nodeId: id });

const file = (name: string) => new File(["x"], name, { type: "video/mp4" });

const setup = (stageHostImport?: (files: readonly File[]) => string | null) => {
	const tasks = createRuntimeTaskFacade();
	const dispatch = vi.fn();
	const env = {
		pageRuntime: { getRootScope: () => scope("root") },
		dkt: { dispatch, dispatchAndWait: vi.fn() },
		tasks,
		platform: stageHostImport ? { stageHostImport } : {},
	} as unknown as EditorActionEnvironment;
	return { actions: createEditorHarnessAdapter(env), dispatch, tasks };
};

describe("host-owned import (desktop platform)", () => {
	it("stages the picked files with the host and starts the import through the model action", () => {
		const stage = vi.fn(() => "batch-from-host");
		const { actions, dispatch } = setup(stage);
		const picked = [file("a.mp4"), file("b.mp4")];

		actions.requestImportFiles(picked);

		expect(stage).toHaveBeenCalledWith(picked);
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch).toHaveBeenCalledWith(
			"requestImportFiles",
			{ inputBatchHandleId: "batch-from-host" },
			scope("root"),
		);
	});

	it("imports into a project through the same action, never in the page", () => {
		const stage = vi.fn(() => "batch-2");
		const { actions, dispatch, tasks } = setup(stage);

		actions.importFilesIntoProject([file("a.mp4")] as unknown as FileList, scope("project:1"));

		expect(dispatch.mock.calls.map(([name]) => name)).toEqual(["requestImportFiles"]);
		// No File reaches the page's runtime refs or its own import task.
		expect(tasks.getRuntimeRef("batch-2")).toBeUndefined();
	});

	it("passes the file of a handle-backed entry, not the handle", () => {
		const stage = vi.fn(() => "batch-3");
		const { actions } = setup(stage);
		const entry = { file: file("c.mp4"), handle: {} as FileSystemFileHandle };

		actions.importFilesIntoProject([entry] as never, scope("project:1"));

		expect(stage).toHaveBeenCalledWith([entry.file]);
	});

	it("starts nothing when the host cannot stage the files", () => {
		const { actions, dispatch } = setup(() => null);

		actions.requestImportFiles([file("a.mp4")]);

		expect(dispatch).not.toHaveBeenCalled();
	});

	it("keeps the page import on platforms without the hook", () => {
		const { actions, dispatch, tasks } = setup();
		const picked = [file("a.mp4")];

		actions.requestImportFiles(picked);

		const [, payload] = dispatch.mock.calls[0] as [string, { inputBatchHandleId: string }];
		expect(dispatch.mock.calls[0][0]).toBe("requestImportFiles");
		expect(tasks.getRuntimeRef(payload.inputBatchHandleId)).toEqual(picked);
	});
});
