import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { describe, expect, it } from "vitest";
import { bootDktModels } from "../testingInit";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { createMiniCutDktRuntime } from "./createMiniCutDktRuntime";

const waitFor = async (predicate: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for condition");
};

const createMemoryTransport = () => {
	const listeners = new Set<(message: MiniCutDktTransportMessage) => void>();
	const sent: MiniCutDktTransportMessage[] = [];

	return {
		transport: {
			send(message: MiniCutDktTransportMessage) {
				sent.push(message);
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

const waitForIdle = async (
	memory: ReturnType<typeof createMemoryTransport>,
): Promise<void> => {
	const requestId = `idle:${Date.now()}:${Math.random().toString(36).slice(2)}`;
	memory.emit({ type: DKT_MSG.WAIT_IDLE, requestId });
	await waitFor(() =>
		memory.sent.some(
			(message) => message.type === DKT_MSG.IDLE && message.requestId === requestId,
		),
	);
};

describe("createMiniCutDktRuntime CRDT bootstrap", () => {
	it("keeps the default runtime CRDT-disabled", async () => {
		const runtime = createMiniCutDktRuntime({ enabled: true });
		const dump = await runtime.debugDumpState();

		expect(dump.booted).toBe(true);
		expect(dump.crdt).toEqual({ enabled: false });
	});

	it("installs a test-only in-memory CRDT runtime", async () => {
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				testOnly: true,
				peerId: "worker-crdt-a",
				storage: "memory",
				transport: null,
			},
		});
		const dump = await runtime.debugDumpState();

		expect(dump.crdt).toMatchObject({
			enabled: true,
			peerId: "worker-crdt-a",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
			hasRegistry: true,
		});
	});

	it("accepts a public DKT CRDT storage package", async () => {
		const storagePackage = makeDktCrdtMemoryStorage();
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				testOnly: true,
				peerId: "worker-crdt-durable",
				storage: storagePackage,
				transport: null,
			},
		});

		const dump = await runtime.debugDumpState();

		expect(dump.crdt).toMatchObject({
			enabled: true,
			peerId: "worker-crdt-durable",
			durableLogCount: 0,
			hasRegistry: true,
		});
		await storagePackage.close?.();
	});

	it("stages local CRDT ops through bootDktModels dispatch", async () => {
		const ctx = await bootDktModels({
			crdt: {
				enabled: true,
				peerId: "model-crdt-a",
				storage: "memory",
				transport: null,
			},
		});

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch("createProject", {
				title: "CRDT staging project",
			});
		});
		ctx.runtime.crdt_runtime?.testing?.drainOutbox?.();

		const project = (await ctx.queryRel(ctx.sessionRoot, "activeProject"))[0];
		if (!project) {
			throw new Error("Expected active project");
		}

		await ctx.lockToRead(async () => {
			await project.dispatch("renameProject", "Renamed through CRDT");
		});

		const ops = ctx.runtime.crdt_runtime?.testing?.drainOutbox?.() ?? [];
		expect(ops).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "attr",
					name: "title",
					value: "Renamed through CRDT",
				}),
			]),
		);
	});

	it("keeps worker ready and sync_sender schema messages on the normal channel", async () => {
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				testOnly: true,
				peerId: "worker-crdt-sync",
				transport: null,
			},
		});
		const memory = createMemoryTransport();
		const connection = runtime.connect(memory.transport);

		memory.emit({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: "session:crdt-sync",
		});

		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		);
		await waitForIdle(memory);

		const schemaMessage = memory.sent.find(
			(message) =>
				message.type === DKT_MSG.SYNC_HANDLE &&
				message.syncType === SYNCR_TYPES.SET_MODEL_SCHEMA,
		) as { payload?: Record<string, unknown> } | undefined;
		expect(schemaMessage?.payload).toBeTruthy();
		expect(schemaMessage?.payload?.$aggregates).toBeUndefined();
		expect(schemaMessage?.payload?.clip).toBeTruthy();

		connection.destroy();
	});
});
