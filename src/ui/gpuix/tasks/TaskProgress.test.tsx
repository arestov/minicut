import { afterEach, describe, expect, test } from "bun:test";
import { AppShell } from "../AppShell";
import { Sidebar } from "../panels/Sidebar";
import { renderWithScenario } from "../test/renderApp";

type View = Awaited<ReturnType<typeof renderWithScenario>>;

let view: View | null = null;

afterEach(() => {
	view?.destroy();
	view = null;
});

const renderShell = (scenario: Parameters<typeof renderWithScenario>[0]) =>
	renderWithScenario(scenario, () => <AppShell sidebar={<Sidebar />} />);

type ExportRequest = { id: string; range: unknown; initiatedBy: string | null };

const exportRequestOf = (current: View): ExportRequest => {
	const [call] = current.fakes.exportCalls;
	return (call as { request: ExportRequest }).request;
};

/** One input step of the export executor: a progress report as its own dispatch. */
const reportExport = (
	current: View,
	request: ExportRequest,
	stage: string,
	progress: number,
	extra: Record<string, unknown> = {},
) =>
	current.runtime.dispatchAndWait(
		"setExportProgress",
		{
			id: request.id,
			range: request.range,
			stage,
			progress,
			updatedAt: 1,
			initiatedBy: request.initiatedBy,
			...extra,
		},
		null,
	);

const stageIs = (stage: string) => (value: unknown) =>
	(value as { stage?: string } | null)?.stage === stage;

describe("export progress", () => {
	test("shows nothing before an export is requested", async () => {
		view = await renderShell("timeline");
		await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		view.settle();

		expect(view.findAll("export-progress")).toHaveLength(0);
	});

	test("follows the model exportProgress attr through each executor step", async () => {
		view = await renderShell("timeline");
		await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);

		await view.runtime.dispatchAndWait("requestProjectExport", {}, null);
		await view.untilAttr(view.rootScope, "exportProgress", stageIs("queued"));
		view.settle();
		expect(view.fakes.exportCalls).toHaveLength(1);
		expect(view.texts()).toContain("Export queued 0%");

		const request = exportRequestOf(view);
		await reportExport(view, request, "rendering", 40);
		await view.untilAttr(view.rootScope, "exportProgress", stageIs("rendering"));
		view.settle();
		expect(view.texts()).toContain("Export rendering 40%");

		await reportExport(view, request, "done", 100, { fileName: "out.webm" });
		await view.untilAttr(view.rootScope, "exportProgress", stageIs("done"));
		view.settle();
		expect(view.texts()).toContain("Export done 100%");
	});

	test("shows the failure the executor reported", async () => {
		view = await renderShell("timeline");
		await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);

		await view.runtime.dispatchAndWait("requestProjectExport", {}, null);
		await view.untilAttr(view.rootScope, "exportProgress", stageIs("queued"));
		await reportExport(view, exportRequestOf(view), "error", 10, { error: "encoder lost" });
		await view.untilAttr(view.rootScope, "exportProgress", stageIs("error"));
		view.settle();

		expect(view.texts()).toContain("Export failed: encoder lost");
	});
});

describe("import progress", () => {
	test("follows the active project importProgress attr", async () => {
		view = await renderShell("timeline");
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		await view.untilAttr(project!, "title", (v) => typeof v === "string");
		view.settle();
		expect(view.findAll("import-progress")).toHaveLength(0);

		await view.runtime.dispatchAndWait("requestImportFiles", { inputBatchHandleId: "batch-1" }, null);
		await view.untilAttr(project!, "importProgress", (v) => (v as { stage?: string } | null)?.stage === "queued");
		view.settle();
		expect(view.fakes.importCalls).toHaveLength(1);
		expect(view.texts()).toContain("Import queued 0/0");

		const report = (stage: string, processed: number, total: number, error?: string) =>
			view!.runtime.dispatchAndWait(
				"setActiveProjectImportProgress",
				{ taskId: "batch-1", stage, processed, total, ...(error ? { error } : {}) },
				null,
			);
		await report("processing", 1, 4);
		await view.untilAttr(project!, "importProgress", (v) => (v as { processed?: number } | null)?.processed === 1);
		view.settle();
		expect(view.texts()).toContain("Import processing 1/4");

		await report("error", 1, 4, "unreadable file");
		await view.untilAttr(project!, "importProgress", (v) => (v as { stage?: string } | null)?.stage === "error");
		view.settle();
		expect(view.texts()).toContain("Import failed: unreadable file");
	});
});

describe("media recovery progress", () => {
	test("shows the phase of the resource's active recovery task", async () => {
		view = await renderShell("unavailable-resource");
		const project = await view.untilOne(view.rootScope, "activeProject", (t) => t !== null);
		const [resource] = await view.untilMany(project!, "resources", (n) => n >= 1);
		await view.untilAttr(resource, "name", (v) => typeof v === "string");
		view.settle();
		expect(view.findAll("recovery-phase")).toHaveLength(0);

		const attempt = {
			operationId: "operation:1",
			attemptId: "operation:1:attempt",
			bootId: "boot:1",
			recoveryKind: "restore",
			intent: "restore",
			createdAt: 100,
			updatedAt: 100,
		};
		await view.runtime.dispatchAndWait("startMediaRecovery", attempt, resource);
		const task = await view.untilOne(resource, "activeMediaRecoveryTask", (t) => t !== null);
		await view.untilAttr(task!, "phase", (v) => v === "inspecting");
		view.settle();
		expect(view.fakes.mediaRecoveryCalls).toHaveLength(1);
		expect(view.texts()).toContain("Recovery: inspecting");

		// The executor reports its inspection result as its own input step.
		await view.runtime.dispatchAndWait(
			"recordInspection",
			{ operationId: "operation:1", classification: "compatible", confirmationRequired: false, updatedAt: 101 },
			task,
		);
		await view.untilAttr(task!, "phase", (v) => v === "ready-to-commit");
		view.settle();
		expect(view.texts()).toContain("Recovery: ready to commit");

		await view.runtime.dispatchAndWait("transition", { operationId: "operation:1", phase: "committing", updatedAt: 102 }, task);
		await view.runtime.dispatchAndWait(
			"transition",
			{ operationId: "operation:1", phase: "failed", errorMessage: "disk full", updatedAt: 103 },
			task,
		);
		await view.untilAttr(task!, "phase", (v) => v === "failed");
		view.settle();
		expect(view.texts()).toContain("Recovery: failed");
	});
});
