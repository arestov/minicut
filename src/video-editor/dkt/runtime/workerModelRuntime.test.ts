import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import * as coreModule from "./createMiniCutDktRuntime";
import * as idbModule from "dkt/crdt/storage/indexeddb.js";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createMiniCutHarnessDbName, MINICUT_INDEXEDDB_SCHEMA_VERSION } from "../../adapters/web/minicutIndexedDbWorkspace";
import { runDktStorageRequest, type DktStorageRequest } from "../storage/dktStorageRequest";
import { describe, expect, it, vi } from "vitest";
import {
	DKT_MSG,
	DKT_TEST_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import {
	createMiniCutDktWorkerModelRuntime,
	orderCrdtReplayBatchesForDelivery,
} from "./workerModelRuntime";

const waitFor = async (predicate: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};

const createMemoryTransport = () => {
	const outgoing = new Set<(message: MiniCutDktTransportMessage) => void>();
	let completeDestroy!: () => void;
	const destroyed = new Promise<void>((resolve) => { completeDestroy = resolve; });
	const listeners = new Set<(message: MiniCutDktTransportMessage) => void>();
	const sent: MiniCutDktTransportMessage[] = [];
	return {
		transport: {
			send(message: MiniCutDktTransportMessage) {
				sent.push(message);
                for (const notify of [...outgoing]) notify(message);
			},
			listen(listener: (message: MiniCutDktTransportMessage) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			destroy() {
				listeners.clear();
                completeDestroy();
			},
		},
		destroyed,
		waitForMessage(predicate: (message: MiniCutDktTransportMessage) => boolean) {
			const matches = (message: MiniCutDktTransportMessage) =>
				message.type === DKT_MSG.RUNTIME_ERROR || message.type === DKT_TEST_MSG.ERROR ||
				predicate(message);
			return new Promise<MiniCutDktTransportMessage>((resolve) => {
				const existing = sent.find(matches);
				if (existing) { resolve(existing); return; }
				const notify = (message: MiniCutDktTransportMessage) => {
					if (!matches(message)) return;
					outgoing.delete(notify);
					resolve(message);
				};
				outgoing.add(notify);
			});
		},
		sent,
		emit(message: MiniCutDktTransportMessage) {
			for (const listener of [...listeners]) {
				listener(message);
			}
		},
	};
};

describe("createMiniCutDktWorkerModelRuntime", () => {
	it("orders replay batches before batches that reference their created nodes", () => {
		const resourceBatch = {
			batch_id: "owner:batch:2",
			created_models: ["crdt:resource"],
			ops: [
				{
					type: "rel",
					node_id: "crdt:resource",
					name: "project",
					value: "crdt:project",
				},
			],
		};
		const projectBatch = {
			batch_id: "server:batch:1",
			created_models: ["crdt:project"],
			ops: [{ type: "attr", node_id: "crdt:project", name: "title" }],
		};

		expect(
			orderCrdtReplayBatchesForDelivery([resourceBatch, projectBatch]).map(
				(batch) => (batch as { batch_id: string }).batch_id,
			),
		).toEqual(["server:batch:1", "owner:batch:2"]);
	});

	it("tracks model sessions per worker connection", async () => {
		const workerRuntime = createMiniCutDktWorkerModelRuntime({
			enableProductionCrdt: false,
		});
		const memory = createMemoryTransport();
		const connection = workerRuntime.connect(memory.transport);

		memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: "session:1" });
		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		);
		expect(workerRuntime.getConnectionCount()).toBe(1);
		expect(workerRuntime.getActiveSessionKeys()).toEqual(["session:1"]);
		expect(
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		).toBe(true);

		memory.emit({ type: DKT_MSG.CLOSE_SESSION });
		expect(workerRuntime.getActiveSessionKeys()).toEqual([]);

		connection.destroy();
		expect(workerRuntime.getConnectionCount()).toBe(0);
	});

	it("acknowledges runtime idle waits after bootstrap", async () => {
		const workerRuntime = createMiniCutDktWorkerModelRuntime({
			enableProductionCrdt: false,
		});
		const memory = createMemoryTransport();
		const connection = workerRuntime.connect(memory.transport);

		memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: "session:idle" });
		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		);

		memory.emit({ type: DKT_TEST_MSG.WAIT_IDLE, requestId: "idle:request-1" });

		await waitFor(() =>
			memory.sent.some(
				(message) =>
					message.type === DKT_TEST_MSG.IDLE &&
					(message as { requestId?: string }).requestId === "idle:request-1",
			),
		);

		expect(memory.sent).toContainEqual({
			type: DKT_TEST_MSG.IDLE,
			requestId: "idle:request-1",
		});

		connection.destroy();
	});

	it("accepts production dispatch without settling the runtime", async () => {
		const workerRuntime = createMiniCutDktWorkerModelRuntime({
			enableProductionCrdt: false,
		});
		const memory = createMemoryTransport();
		const connection = workerRuntime.connect(memory.transport);

		memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: "session:dispatch" });
		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		);

		memory.emit({
			type: DKT_MSG.DISPATCH_ACTION,
			requestId: "dispatch:1",
			actionName: "setActiveInspectorTab",
			payload: "edit",
		});

		await waitFor(() =>
			memory.sent.some(
				(message) =>
					message.type === DKT_MSG.ACTION_ACCEPTED &&
					message.requestId === "dispatch:1",
			),
		);

		expect(memory.sent).toContainEqual({
			type: DKT_MSG.ACTION_ACCEPTED,
			requestId: "dispatch:1",
			actionName: "setActiveInspectorTab",
			sessionId: "session:dispatch",
			sessionKey: "session:dispatch",
		});
		expect(
			memory.sent.some((message) => message.type === DKT_TEST_MSG.IDLE),
		).toBe(false);

		connection.destroy();
	});
it("owns IndexedDB across page reconnects until worker runtime disposal", async () => {
  const sessionKey = "r347-worker-authority";
  const dbName = createMiniCutHarnessDbName(sessionKey);
  const idb = new IDBFactory();
  const realMake = idbModule.makeDktCrdtIndexedDBStorage;
  const coreFactory = vi.spyOn(coreModule, "createMiniCutDktRuntime");
  let authorityObserved = false;
  let closeCalls = 0;
  let closeCompletions = 0;
  const storageFactory = vi.spyOn(idbModule, "makeDktCrdtIndexedDBStorage")
    .mockImplementation(async (...args) => {
      const raw = await realMake(...args);
      if (authorityObserved || args[0]?.dbName !== dbName) return raw;
      authorityObserved = true;
      return {
        ...raw,
        close: async () => {
          closeCalls += 1;
          await raw.close();
          closeCompletions += 1;
        },
      };
    });
  let worker: ReturnType<typeof createMiniCutDktWorkerModelRuntime> | undefined;
  let reader: Awaited<ReturnType<typeof realMake>> | undefined;
  const connections: { connection: { destroy(): void }; destroyed: Promise<void> }[] = [];
  const pages: ReturnType<typeof createMemoryTransport>[] = [];
  let primary: { error: unknown } | undefined;
  const cleanupErrors: unknown[] = [];
  try {
    vi.stubEnv("VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS", "1");
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    worker = createMiniCutDktWorkerModelRuntime();
    // Genuine host-ownership invariant; finite old-code catch BEFORE any connection/open.
    expect(coreFactory).toHaveBeenCalledTimes(1);
    expect(storageFactory).not.toHaveBeenCalled();
    expect(coreFactory.mock.calls[0]?.[0]?.keepStorageOpenOnDisconnect).toBe(true);

    const first = createMemoryTransport();
    pages.push(first);
    const firstConnection = worker.connect(first.transport);
    connections.push({ connection: firstConnection, destroyed: first.destroyed });
    const firstReply = first.waitForMessage((m) => m.type === DKT_MSG.RUNTIME_READY);
    first.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey, sessionId: sessionKey });
    const firstReady = await firstReply;
    if (firstReady.type !== DKT_MSG.RUNTIME_READY) throw new Error(JSON.stringify(firstReady));
    expect(firstReady.rootNodeId).toEqual(expect.any(String));
    expect(firstReady.rootNodeId).not.toBe("");
    expect(authorityObserved).toBe(true);
    firstConnection.destroy(); // void
    await first.destroyed; // actual core finally -> forwarded transport.destroy
    expect(worker.getConnectionCount()).toBe(0);
    expect(worker.getActiveSessionKeys()).toEqual([]);
    expect(closeCalls).toBe(0);
    expect(closeCompletions).toBe(0);

    const second = createMemoryTransport();
    pages.push(second);
    const secondConnection = worker.connect(second.transport);
    connections.push({ connection: secondConnection, destroyed: second.destroyed });
    const secondReply = second.waitForMessage((m) => m.type === DKT_MSG.RUNTIME_READY);
    second.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey, sessionId: sessionKey });
    const secondReady = await secondReply;
    if (secondReady.type !== DKT_MSG.RUNTIME_READY) throw new Error(JSON.stringify(secondReady));
    expect(secondReady).toMatchObject({
      sessionKey, sessionId: sessionKey, rootNodeId: firstReady.rootNodeId,
    });
    expect(second.sent).toContainEqual(expect.objectContaining({
      type: DKT_MSG.SYNC_HANDLE, syncType: SYNCR_TYPES.TREE_ROOT,
      payload: expect.objectContaining({ node_id: secondReady.rootNodeId }),
    }));

    const requestId = "r347-create-project";
    const created = second.waitForMessage((m) =>
      m.type === DKT_TEST_MSG.IDLE && m.requestId === requestId);
    second.emit({
      type: DKT_TEST_MSG.DISPATCH_ACTION_AND_SETTLE,
      requestId, actionName: "createProject", payload: { title: "After worker reconnect" },
    });
    const creationReply = await created;
    if (creationReply.type !== DKT_TEST_MSG.IDLE) throw new Error(JSON.stringify(creationReply));
    // IDLE is transport completion only; actual durability is checked below.
    reader = await realMake({
      indexedDB: idb, keyRange: IDBKeyRange, dbName,
      version: MINICUT_INDEXEDDB_SCHEMA_VERSION,
    });
    type Snapshot = { models: Record<string, {
      model_name: string; attrs: { title?: unknown };
    }> } | null;
    const snapshot = await runDktStorageRequest(
      reader.dktStorage.getSnapshot as DktStorageRequest<Snapshot>);
    expect(Object.values(snapshot?.models ?? {}).some((model) =>
      model.model_name === "project" && model.attrs.title === "After worker reconnect",
    )).toBe(true);
    expect(closeCalls).toBe(0);

    secondConnection.destroy();
    await second.destroyed;
    expect(worker.getConnectionCount()).toBe(0);
    expect(closeCalls).toBe(0);
    await worker.runtime.dispose();
    expect(closeCalls).toBe(1);
    expect(closeCompletions).toBe(1); // awaited actual real adapter close
    await worker.runtime.dispose();
    expect(closeCalls).toBe(1);
    expect(closeCompletions).toBe(1);
  } catch (error) {
    primary = { error };
  } finally {
    for (const owned of connections) {
      try { owned.connection.destroy(); await owned.destroyed; }
      catch (error) { cleanupErrors.push(error); }
    }
    try { await worker?.runtime.dispose(); } catch (error) { cleanupErrors.push(error); }
    if (reader) {
      try { await reader.close(); } catch (error) { cleanupErrors.push(error); }
    }
    storageFactory.mockRestore();
    coreFactory.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  if (primary) {
    for (const error of cleanupErrors) console.error("Worker lifetime cleanup error", error);
    throw primary.error;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Worker lifetime cleanup failed");
  expect(pages.flatMap((page) => page.sent).filter((m) =>
    m.type === DKT_MSG.RUNTIME_ERROR || m.type === DKT_TEST_MSG.ERROR)).toEqual([]);
});
});
