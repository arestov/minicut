import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { describe, expect, it } from "vitest";
import type { MiniCutEffectInterfaces } from "../../core/contracts/effectInterfaces";
import {
	DKT_MSG,
	DKT_TEST_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { createMiniCutDktRuntime } from "./createMiniCutDktRuntime";

const TASK_REQUEST_TYPES: readonly string[] = [
	DKT_MSG.EXPORT_REQUEST,
	DKT_MSG.IMPORT_FILES_REQUEST,
	DKT_MSG.MEDIA_RECOVERY_REQUEST,
	DKT_MSG.PLAYBACK_RUN_REQUEST,
];

const createMemoryTransport = () => {
	const listeners = new Set<(message: MiniCutDktTransportMessage) => void>();
	const sent: MiniCutDktTransportMessage[] = [];
	const waiters = new Set<() => void>();
	return {
		waiters,
		transport: {
			send(message: MiniCutDktTransportMessage) {
				sent.push(message);
				for (const waiter of [...waiters]) {
					waiter();
				}
			},
			listen(listener: (message: MiniCutDktTransportMessage) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			destroy() {
				listeners.clear();
			},
		},
		sent,
		emit(message: MiniCutDktTransportMessage) {
			for (const listener of [...listeners]) {
				listener(message);
			}
		},
	};
};

type Memory = ReturnType<typeof createMemoryTransport>;

/** Resolves when a message matching the predicate has been sent to the page. */
const waitForSent = (
	memory: Memory,
	predicate: (message: MiniCutDktTransportMessage) => boolean,
): Promise<void> =>
	new Promise((resolve) => {
		const check = () => {
			if (memory.sent.some(predicate)) {
				memory.waiters.delete(check);
				resolve();
			}
		};
		memory.waiters.add(check);
		check();
	});

let idleSeq = 0;
const waitForIdle = async (memory: Memory): Promise<void> => {
	idleSeq += 1;
	const requestId = `idle:effect-interfaces:${idleSeq}`;
	memory.emit({ type: DKT_TEST_MSG.WAIT_IDLE, requestId });
	await waitForSent(
		memory,
		(message) =>
			message.type === DKT_TEST_MSG.IDLE && message.requestId === requestId,
	);
};

const createRecordingInterfaces = () => {
	const calls = {
		export: [] as unknown[],
		import: [] as unknown[],
		mediaRecovery: [] as unknown[],
		playback: [] as unknown[],
	};
	const changed = new Set<() => void>();
	const record = (list: unknown[]) => (payload: unknown) => {
		list.push(payload);
		for (const listener of [...changed]) {
			listener();
		}
	};
	/** Resolves once the implementation has been called `count` times. */
	const whenCalled = (list: unknown[], count: number): Promise<void> =>
		new Promise((resolve) => {
			const check = () => {
				if (list.length >= count) {
					changed.delete(check);
					resolve();
				}
			};
			changed.add(check);
			check();
		});
	const interfaces: MiniCutEffectInterfaces = {
		exportRuntime: { requestExport: record(calls.export) },
		importRuntime: { requestImportFiles: record(calls.import) },
		mediaRecoveryRuntime: { requestMediaRecovery: record(calls.mediaRecovery) },
		playbackRuntime: { applyPlaybackRun: record(calls.playback) },
	};
	return { interfaces, calls, whenCalled };
};

type ModelDump = {
	workerState?: { runtimeModels?: readonly { modelName?: string | null }[] };
};

// The worker test protocol exposes no model query path (only debug dump), so read the dump.
const countProjects = async (
	runtime: ReturnType<typeof createMiniCutDktRuntime>,
): Promise<number> =>
	(
		((await runtime.debugDumpState()) as ModelDump).workerState?.runtimeModels ??
		[]
	).filter((model) => model.modelName === "project").length;

const taskRequestsSentToPages = (memory: Memory) =>
	memory.sent.filter((message) => TASK_REQUEST_TYPES.includes(message.type));

const bootstrap = async (memory: Memory, sessionKey: string) => {
	memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey });
	await waitForSent(
		memory,
		(message) => message.type === DKT_MSG.RUNTIME_READY,
	);
};

const dispatch = async (
	memory: Memory,
	actionName: string,
	payload: unknown,
): Promise<void> => {
	idleSeq += 1;
	const requestId = `settle:effect-interfaces:${idleSeq}`;
	memory.emit({
		type: DKT_TEST_MSG.DISPATCH_ACTION_AND_SETTLE,
		requestId,
		actionName,
		payload,
		scopeNodeId: null,
	});
	await waitForSent(
		memory,
		(message) =>
			message.type === DKT_TEST_MSG.IDLE && message.requestId === requestId,
	);
};

describe("createMiniCutDktRuntime injected effect interfaces", () => {
	it("calls the injected export and import implementations once and publishes nothing to pages", async () => {
		const { interfaces, calls, whenCalled } = createRecordingInterfaces();
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			effectInterfaces: interfaces,
		});
		const memory = createMemoryTransport();
		const connection = runtime.connect(memory.transport);
		await bootstrap(memory, "session:injected-effects");

		await dispatch(memory, "createProject", { title: "Injected effects" });
		await dispatch(memory, "requestProjectExport", {
			id: "export:injected-1",
			initiatedBy: "unit-test",
		});
		await whenCalled(calls.export, 1);
		await dispatch(memory, "requestImportFiles", {
			inputBatchHandleId: "input-batch:injected-1",
		});
		await whenCalled(calls.import, 1);

		expect(calls.export).toHaveLength(1);
		expect(calls.export[0]).toMatchObject({
			request: { id: "export:injected-1", range: { type: "project" } },
			queueKey: "project",
		});
		expect(calls.import).toHaveLength(1);
		expect(calls.import[0]).toMatchObject({
			inputBatchHandleId: "input-batch:injected-1",
		});
		expect(typeof (calls.import[0] as { projectId?: unknown }).projectId).toBe(
			"string",
		);
		expect(taskRequestsSentToPages(memory)).toEqual([]);

		connection.destroy();
	});

	it("uses the same injected set after restoring a runtime from storage", async () => {
		const storagePackage = makeDktCrdtMemoryStorage() as ReturnType<
			typeof makeDktCrdtMemoryStorage
		> & {
			commitChanges?: (meta?: unknown) => Promise<void>;
			close?: () => Promise<void>;
		};
		const crdt = {
			enabled: true as const,
			peerId: "worker-effect-interfaces-restore",
			storage: storagePackage,
			workspaceIdForSessionKey: (sessionKey: string) => `harness:room:${sessionKey}`,
			transport: null,
		};

		const first = createRecordingInterfaces();
		const firstRuntime = createMiniCutDktRuntime({
			enabled: true,
			crdt,
			effectInterfaces: first.interfaces,
		});
		const firstMemory = createMemoryTransport();
		const firstConnection = firstRuntime.connect(firstMemory.transport);
		await bootstrap(firstMemory, "restore-room");
		await dispatch(firstMemory, "createProject", { title: "Restored project" });
		await storagePackage.commitChanges?.({ reason: "effect-interfaces-restore" });
		const projectsBeforeRestore = await countProjects(firstRuntime);
		expect(projectsBeforeRestore).toBeGreaterThan(1);
		firstConnection.destroy();

		const second = createRecordingInterfaces();
		const secondRuntime = createMiniCutDktRuntime({
			enabled: true,
			crdt,
			effectInterfaces: second.interfaces,
		});
		const secondMemory = createMemoryTransport();
		const secondConnection = secondRuntime.connect(secondMemory.transport);
		await bootstrap(secondMemory, "restore-room");
		await waitForIdle(secondMemory);

		expect(await countProjects(secondRuntime)).toBe(projectsBeforeRestore);

		await dispatch(secondMemory, "requestProjectExport", {
			id: "export:restored-1",
			initiatedBy: "unit-test",
		});
		await second.whenCalled(second.calls.export, 1);

		expect(second.calls.export).toHaveLength(1);
		expect(second.calls.export[0]).toMatchObject({
			request: { id: "export:restored-1" },
		});
		expect(first.calls.export).toHaveLength(0);
		expect(taskRequestsSentToPages(secondMemory)).toEqual([]);

		secondConnection.destroy();
		await storagePackage.close?.();
	});

	it("keeps the browser default publishing to pages when nothing is injected", async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true });
		const memory = createMemoryTransport();
		const connection = runtime.connect(memory.transport);
		await bootstrap(memory, "session:default-effects");

		await dispatch(memory, "createProject", { title: "Default effects" });
		await dispatch(memory, "requestProjectExport", {
			id: "export:default-1",
			initiatedBy: "unit-test",
		});
		await waitForSent(
			memory,
			(message) => message.type === DKT_MSG.EXPORT_REQUEST,
		);

		expect(
			memory.sent.filter((message) => message.type === DKT_MSG.EXPORT_REQUEST),
		).toHaveLength(1);

		connection.destroy();
	});

	it("fails host composition when the injected set is incomplete", () => {
		const { interfaces } = createRecordingInterfaces();
		const { playbackRuntime: _omitted, ...withoutPlayback } = interfaces;
		expect(() =>
			createMiniCutDktRuntime({
				enabled: true,
				effectInterfaces: withoutPlayback as unknown as MiniCutEffectInterfaces,
			}),
		).toThrow("Incomplete MiniCut effect interfaces: playbackRuntime (missing interface)");

		expect(() =>
			createMiniCutDktRuntime({
				enabled: true,
				effectInterfaces: {
					...interfaces,
					exportRuntime: {},
					mediaRecoveryRuntime: { requestMediaRecovery: "nope" },
				} as unknown as MiniCutEffectInterfaces,
			}),
		).toThrow(
			"exportRuntime.requestExport, mediaRecoveryRuntime.requestMediaRecovery",
		);
	});
});
