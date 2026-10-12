import { describe, expect, it } from "vitest";
import { createRuntimeTaskFacade } from "./runtimeTaskFacade";

describe("createRuntimeTaskFacade", () => {
	it("keeps first runtime refs distinct across prefixed owners", () => {
		const first = createRuntimeTaskFacade({ runtimeRefPrefix: "first:rt_tmp_" });
		const second = createRuntimeTaskFacade({ runtimeRefPrefix: "second:rt_tmp_" });
		const firstFile = new File(["first bytes"], "first.txt");
		const secondFile = new File(["second bytes"], "second.txt");
		const firstId = first.putRuntimeRef(firstFile);
		const secondId = second.putRuntimeRef(secondFile);

		expect(firstId).toBe("first:rt_tmp_1");
		expect(secondId).toBe("second:rt_tmp_1");
		expect(firstId).not.toBe(secondId);
		expect(first.getRuntimeRef(secondId)).toBeUndefined();
		expect(second.getRuntimeRef(firstId)).toBeUndefined();
		expect(first.getRuntimeRef(firstId)).toBe(firstFile);
		expect(second.getRuntimeRef(secondId)).toBe(secondFile);
		expect(createRuntimeTaskFacade().putRuntimeRef(firstFile)).toBe("rt_tmp_1");
	});
	it("stores runtimeRef as runtimeHandleId and consumes it once", () => {
		const tasks = createRuntimeTaskFacade();
		const file = new File(["a"], "a.txt", { type: "text/plain" });

		const task = tasks.dispatchTask("$fx_handleInputFiles", {
			runtimeRef: [file],
			data: { source: "input" },
		});

		expect(task.payload.runtimeHandleId).toBeDefined();
		expect(task.payload.data).toEqual({ source: "input" });

		const firstConsume = tasks.consumeRuntimeRef(
			String(task.payload.runtimeHandleId),
		);
		expect(firstConsume).toEqual([file]);

		const secondConsume = tasks.consumeRuntimeRef(
			String(task.payload.runtimeHandleId),
		);
		expect(secondConsume).toBeUndefined();
	});

	it("drops keep-first duplicate task and releases new runtimeRef", () => {
		const tasks = createRuntimeTaskFacade();
		const first = tasks.dispatchTask(
			"$fx_handleInputFiles",
			{
				runtimeRef: [new File(["a"], "a.txt", { type: "text/plain" })],
			},
			{
				queuePolicy: "keep-first",
				intentKey: "import",
			},
		);
		const second = tasks.dispatchTask(
			"$fx_handleInputFiles",
			{
				runtimeRef: [new File(["b"], "b.txt", { type: "text/plain" })],
			},
			{
				queuePolicy: "keep-first",
				intentKey: "import",
			},
		);

		expect(second.dropped).toBe(true);
		expect(second.payload.runtimeHandleId).toBeUndefined();
		expect(
			tasks.consumeRuntimeRef(String(first.payload.runtimeHandleId)),
		).toBeTruthy();
	});

	it("releases replaced runtimeRef for replace-last queue policy", () => {
		const tasks = createRuntimeTaskFacade();
		const first = tasks.dispatchTask(
			"$fx_handleInputFiles",
			{
				runtimeRef: [new File(["a"], "a.txt", { type: "text/plain" })],
			},
			{
				queuePolicy: "replace-last",
				intentKey: "import",
			},
		);
		const second = tasks.dispatchTask(
			"$fx_handleInputFiles",
			{
				runtimeRef: [new File(["b"], "b.txt", { type: "text/plain" })],
			},
			{
				queuePolicy: "replace-last",
				intentKey: "import",
			},
		);

		expect(second.replacedTaskId).toBe(first.taskId);
		expect(
			tasks.consumeRuntimeRef(String(first.payload.runtimeHandleId)),
		).toBeUndefined();
		expect(
			tasks.consumeRuntimeRef(String(second.payload.runtimeHandleId)),
		).toBeTruthy();
	});

	it("provides debug queue dump with active, completed, failed and dropped counters", () => {
		const tasks = createRuntimeTaskFacade();

		const active = tasks.dispatchTask("$fx_handleInputFiles", {
			data: { id: "active" },
		});
		const completed = tasks.dispatchTask("$fx_renderExport", {
			data: { id: "completed" },
		});
		const failed = tasks.dispatchTask(
			"$fx_renderExport",
			{ data: { id: "failed" } },
			{ intentKey: "export:failed" },
		);
		const kept = tasks.dispatchTask(
			"$fx_renderExport",
			{ data: { id: "keep-1" } },
			{
				queuePolicy: "keep-first",
				intentKey: "export:keep-first",
			},
		);
		const dropped = tasks.dispatchTask(
			"$fx_renderExport",
			{ data: { id: "keep-2" } },
			{
				queuePolicy: "keep-first",
				intentKey: "export:keep-first",
			},
		);

		tasks.completeTask(completed);
		tasks.failTask(failed);

		const dump = tasks.debugDumpTasksTesting();

		expect(dump.completed).toBe(1);
		expect(dump.failed).toBe(1);
		expect(dump.dropped).toBe(1);
		expect(dump.active.map((task) => task.taskId).sort()).toEqual(
			[active.taskId, kept.taskId].sort(),
		);
		expect(
			dump.active.find((task) => task.taskId === dropped.taskId),
		).toBeUndefined();
		expect(dump.byFxName.$fx_handleInputFiles).toBe(1);
		expect(dump.byFxName.$fx_renderExport).toBe(4);
	});
});
