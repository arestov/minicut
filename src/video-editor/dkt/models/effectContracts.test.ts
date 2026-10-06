import { describe, expect, it } from "vitest";
import {
	createEffectContractFakes,
	createTaskProtocolDriver,
} from "../test/effectContractFakes";
import { queryAttr, queryRel } from "../testingInit";
import {
	createActionContractHarness,
	dispatchAndSettle,
} from "./action-contract-test-harness";

const setup = async () => {
	const fakes = createEffectContractFakes();
	const harness = await createActionContractHarness({
		interfaces: fakes.interfaces as unknown as Record<string, unknown>,
	});
	const driver = createTaskProtocolDriver(harness.ctx);
	return { fakes, harness, driver };
};

type Setup = Awaited<ReturnType<typeof setup>>;

const requestExport = async (
	{ harness }: Pick<Setup, "harness">,
	id: string,
) => {
	await dispatchAndSettle(
		harness.ctx,
		harness.sessionRoot,
		"requestProjectExport",
		{ id, initiatedBy: "contract-suite" },
	);
};

const requestOf = (call: unknown) =>
	(call as { request: Record<string, unknown> }).request;

describe("effect contract suite: export", () => {
	it("calls the export implementation once with the request payload", async () => {
		const { fakes, harness } = await setup();

		await requestExport({ harness }, "export:contract-1");

		expect(fakes.exportCalls).toHaveLength(1);
		expect(fakes.exportCalls[0]).toMatchObject({
			request: {
				id: "export:contract-1",
				range: { type: "project" },
				format: "video-webm",
				initiatedBy: "contract-suite",
			},
			queueKey: "project",
		});
		expect(await queryAttr(harness.sessionRoot, "exportProgress")).toMatchObject({
			id: "export:contract-1",
			stage: "queued",
		});
	});

	it("reflects asynchronous progress and completion in exportProgress", async () => {
		const { fakes, harness, driver } = await setup();
		await requestExport({ harness }, "export:contract-2");
		const request = requestOf(fakes.exportCalls[0]);

		await driver.export.progress(request, "rendering", 40);
		expect(await queryAttr(harness.sessionRoot, "exportProgress")).toMatchObject({
			id: "export:contract-2",
			stage: "rendering",
			progress: 40,
		});

		await driver.export.progress(request, "done", 100, {
			fileName: "out.webm",
			size: 1234,
			frameCount: 60,
		});
		await driver.export.consume(request);
		expect(await queryAttr(harness.sessionRoot, "exportProgress")).toMatchObject({
			stage: "done",
			progress: 100,
			fileName: "out.webm",
			size: 1234,
			frameCount: 60,
		});
		expect(await queryAttr(harness.sessionRoot, "exportRequest")).toBeNull();
	});

	it("reflects an export failure in exportProgress", async () => {
		const { fakes, harness, driver } = await setup();
		await requestExport({ harness }, "export:contract-3");
		const request = requestOf(fakes.exportCalls[0]);

		await driver.export.progress(request, "error", 0, { error: "render failed" });

		expect(await queryAttr(harness.sessionRoot, "exportProgress")).toMatchObject({
			id: "export:contract-3",
			stage: "error",
			error: "render failed",
		});
	});

	it("ignores a consume for a superseded export request id", async () => {
		const { fakes, harness, driver } = await setup();
		await requestExport({ harness }, "export:old");
		await requestExport({ harness }, "export:new");
		expect(fakes.exportCalls).toHaveLength(2);
		const oldRequest = requestOf(fakes.exportCalls[0]);
		const newRequest = requestOf(fakes.exportCalls[1]);

		await driver.export.consume(oldRequest);
		expect(await queryAttr(harness.sessionRoot, "exportRequest")).toMatchObject({
			id: "export:new",
		});

		await driver.export.consume(newRequest);
		expect(await queryAttr(harness.sessionRoot, "exportRequest")).toBeNull();
	});
});

describe("effect contract suite: import", () => {
	it("calls the import implementation once with the resolved project and batch", async () => {
		const { fakes, harness } = await setup();

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "requestImportFiles", {
			inputBatchHandleId: "input-batch:contract-1",
		});

		expect(fakes.importCalls).toHaveLength(1);
		expect(fakes.importCalls[0]).toEqual({
			projectId: harness.project._node_id,
			inputBatchHandleId: "input-batch:contract-1",
			addToTimelineWhenEmpty: true,
		});
	});

	it("reflects asynchronous import progress, completion and failure", async () => {
		const { harness, driver } = await setup();
		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "requestImportFiles", {
			inputBatchHandleId: "input-batch:contract-2",
		});

		await driver.import.progress("input-batch:contract-2", "processing", 1, 2);
		expect(await queryAttr(harness.project, "importProgress")).toEqual({
			stage: "processing",
			processed: 1,
			total: 2,
		});
		expect(await queryAttr(harness.project, "activeImportTaskId")).toBe(
			"input-batch:contract-2",
		);

		await driver.import.progress("input-batch:contract-2", "done", 2, 2);
		expect(await queryAttr(harness.project, "importProgress")).toMatchObject({
			stage: "done",
		});
		expect(await queryAttr(harness.project, "activeImportTaskId")).toBeNull();

		await driver.import.progress(
			"input-batch:contract-2",
			"error",
			1,
			2,
			"decode failed",
		);
		expect(await queryAttr(harness.project, "lastImportError")).toBe(
			"decode failed",
		);
	});
});

describe("effect contract suite: playback", () => {
	it("applies one run, ignores a stale completion and accepts the current one", async () => {
		const { fakes, harness, driver } = await setup();
		// Project setup already pushed idle-state calls through the effect.
		const callsBeforePlay = fakes.playbackCalls.length;
		const callsSincePlay = () => fakes.playbackCalls.slice(callsBeforePlay);

		await dispatchAndSettle(harness.ctx, harness.sessionRoot, "play");
		expect(callsSincePlay()).toHaveLength(1);
		expect(callsSincePlay()[0]).toMatchObject({
			run: {
				runId: 1,
				startCursorSeconds: 0,
				playbackRate: 1,
				boundaryCursorSeconds: 12,
			},
		});

		await driver.playback.complete(0, 12);
		expect(await queryAttr(harness.sessionRoot, "isPlaying")).toBe(true);
		expect(callsSincePlay()).toHaveLength(1);

		await driver.playback.complete(1, 12);
		expect(await queryAttr(harness.sessionRoot, "isPlaying")).toBe(false);
		expect(await queryAttr(harness.sessionRoot, "cursor")).toBe(12);
		expect(callsSincePlay()).toHaveLength(2);
		expect(callsSincePlay()[1]).toEqual({ run: null, committedCursor: 12 });
	});
});

describe("effect contract suite: media recovery", () => {
	const attempt = (operationId: string, bootId = "boot:contract") => ({
		bootId,
		operationId,
		attemptId: `${operationId}:attempt`,
		recoveryKind: "restore",
		intent: "restore",
		createdAt: 100,
		updatedAt: 100,
		runtimeHandleId: "rt_tmp_contract",
	});

	const startRecovery = async (
		harness: Setup["harness"],
		operationId: string,
		bootId?: string,
	) => {
		await dispatchAndSettle(
			harness.ctx,
			harness.videoResource,
			"startMediaRecovery",
			attempt(operationId, bootId),
		);
		const [task] = await queryRel(
			harness.videoResource,
			"activeMediaRecoveryTask",
		);
		if (!task) {
			throw new Error("Expected active media recovery task");
		}
		return task;
	};

	it("calls the media recovery implementation once with a serializable payload", async () => {
		const { fakes, harness } = await setup();

		const task = await startRecovery(harness, "operation:contract-1");

		expect(fakes.mediaRecoveryCalls).toHaveLength(1);
		expect(fakes.mediaRecoveryCalls[0]).toMatchObject({
			taskId: task._node_id,
			resourceId: harness.videoResource._node_id,
			operationId: "operation:contract-1",
			bootId: "boot:contract",
			intent: "restore",
			runtimeHandleId: "rt_tmp_contract",
		});
		expect(await queryAttr(task, "phase")).toBe("inspecting");
	});

	it("applies an inspection result and ignores one for a stale operation", async () => {
		const { harness, driver } = await setup();
		const task = await startRecovery(harness, "operation:contract-2");

		await driver.mediaRecovery.inspected(task, {
			operationId: "operation:stale",
			classification: "compatible",
			updatedAt: 200,
		});
		expect(await queryAttr(task, "phase")).toBe("inspecting");

		await driver.mediaRecovery.inspected(task, {
			operationId: "operation:contract-2",
			classification: "compatible",
			updatedAt: 201,
		});
		expect(await queryAttr(task, "phase")).toBe("ready-to-commit");
	});

	it("reflects failure and cancellation as task outcomes", async () => {
		const { harness, driver } = await setup();
		const failed = await startRecovery(harness, "operation:contract-3");
		await driver.mediaRecovery.transition(failed, {
			operationId: "operation:contract-3",
			phase: "failed",
			errorMessage: "inspect failed",
			updatedAt: 300,
		});
		expect(await queryAttr(failed, "phase")).toBe("failed");
		expect(await queryAttr(failed, "errorMessage")).toBe("inspect failed");

		const cancelled = await startRecovery(
			harness,
			"operation:contract-4",
			"boot:contract-2",
		);
		await driver.mediaRecovery.transition(cancelled, {
			operationId: "operation:contract-4",
			phase: "cancelled",
			updatedAt: 400,
		});
		expect(await queryAttr(cancelled, "phase")).toBe("cancelled");
		expect(await queryAttr(cancelled, "outcome")).toBe("cancelled");
	});
});
