import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import { indexedDB } from "fake-indexeddb";
import { makeDktCrdtMemoryStorage } from "dkt/crdt/storage/memory.js";
import { describe, expect, it } from "vitest";
import { bootDktModels } from "../testingInit";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { createMiniCutStoredDktManifest } from "../storage/minicutWorkspaceManifest";
import { createMiniCutDktRuntime } from "./createMiniCutDktRuntime";
import {
	WORKSPACE_OPEN_FAILURE,
	WORKSPACE_OPEN_STATUS,
} from "./workspaceOpenState";

type MemoryStoragePackage = ReturnType<typeof makeDktCrdtMemoryStorage>;

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

	it("stages a workspace manifest for empty room-backed storage", async () => {
		const storagePackage = makeDktCrdtMemoryStorage() as MemoryStoragePackage & {
			dktStorage: { getManifest?: () => Promise<unknown> };
			commitChanges?: (meta?: unknown) => Promise<void>;
			close?: () => Promise<void>;
		};
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				peerId: "worker-crdt-manifest-stage",
				storage: storagePackage,
				workspaceIdForSessionKey: (sessionKey) => `harness:room:${sessionKey}`,
				transport: null,
			},
		});

		await runtime.debugDumpState();
		await storagePackage.commitChanges?.({ reason: "test-stage-manifest" });

		await expect(storagePackage.dktStorage.getManifest?.()).resolves.toMatchObject({
			workspaceId: "harness:room:minicut-local",
			storageVersion: 1,
			schemaVersion: 1,
		});
		await storagePackage.close?.();
	});

	it("uses the bootstrapped session key when opening room-backed storage", async () => {
		const storagePackage = makeDktCrdtMemoryStorage() as MemoryStoragePackage & {
			dktStorage: { getManifest?: () => Promise<unknown> };
			commitChanges?: (meta?: unknown) => Promise<void>;
			close?: () => Promise<void>;
		};
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				peerId: "worker-crdt-transport-room",
				storage: storagePackage,
				workspaceIdForSessionKey: (sessionKey) => `harness:room:${sessionKey}`,
				transport: null,
			},
		});
		const memory = createMemoryTransport();
		const connection = runtime.connect(memory.transport);

		memory.emit({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: "room-from-bootstrap",
		});
		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		);
		await waitForIdle(memory);
		await storagePackage.commitChanges?.({ reason: "test-bootstrap-session-key" });

		await expect(storagePackage.dktStorage.getManifest?.()).resolves.toMatchObject({
			workspaceId: "harness:room:room-from-bootstrap",
			storageVersion: 1,
			schemaVersion: 1,
		});

		connection.destroy();
		await storagePackage.close?.();
	});

	it("does not create a default project or rewrite the manifest for ready room-backed storage", async () => {
		const storagePackage = makeDktCrdtMemoryStorage() as MemoryStoragePackage & {
			dktStorage: {
				getManifest?: () => Promise<unknown>;
				putManifest?: (value: unknown) => void;
			};
			commitChanges?: (meta?: unknown) => Promise<void>;
			close?: () => Promise<void>;
		};
		const seededManifest = createMiniCutStoredDktManifest(
			"harness:room:ready-room",
		);
		storagePackage.dktStorage.putManifest?.(seededManifest);
		await storagePackage.commitChanges?.({ reason: "seed-ready-manifest" });

		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				peerId: "worker-crdt-ready-bootstrap",
				storage: storagePackage,
				workspaceIdForSessionKey: (sessionKey) => `harness:room:${sessionKey}`,
				transport: null,
			},
		});
		const memory = createMemoryTransport();
		const connection = runtime.connect(memory.transport);

		memory.emit({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: "ready-room",
		});
		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		);
		await waitForIdle(memory);
		await storagePackage.commitChanges?.({ reason: "ready-bootstrap" });

		const dump = (await runtime.debugDumpState()) as {
			workspaceOpenState?: { status?: unknown; failureReason?: unknown } | null;
			runtimeModels?: readonly { modelName?: string | null }[];
		};
		expect(dump.workspaceOpenState).toEqual({
			status: WORKSPACE_OPEN_STATUS.READY,
			failureReason: WORKSPACE_OPEN_FAILURE.NONE,
		});
		expect(
			memory.sent.find(
				(message) => message.type === DKT_MSG.WORKSPACE_OPEN_STATE,
			),
		).toMatchObject({
			state: {
				status: WORKSPACE_OPEN_STATUS.READY,
				failureReason: WORKSPACE_OPEN_FAILURE.NONE,
			},
		});
		expect(
			dump.runtimeModels?.filter((model) => model.modelName === "project") ?? [],
		).toHaveLength(0);
		await expect(storagePackage.dktStorage.getManifest?.()).resolves.toEqual(
			seededManifest,
		);

		connection.destroy();
		await storagePackage.close?.();
	});

	it("reports a runtime error for unsupported newer workspace storage", async () => {
		const storagePackage = makeDktCrdtMemoryStorage() as MemoryStoragePackage & {
			dktStorage: { putManifest?: (value: unknown) => void };
			commitChanges?: (meta?: unknown) => Promise<void>;
			close?: () => Promise<void>;
		};
		storagePackage.dktStorage.putManifest?.({
			manifestVersion: 1,
			storageVersion: 99,
			schemaVersion: 1,
			appId: "minicut",
			profileId: "minicut-crdt-v1",
			schemaDictionaryMode: "none",
			workspaceId: "harness:room:newer-room",
		});
		await storagePackage.commitChanges?.({ reason: "seed-newer-manifest" });

		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				peerId: "worker-crdt-newer-storage",
				storage: storagePackage,
				workspaceIdForSessionKey: (sessionKey) => `harness:room:${sessionKey}`,
				transport: null,
			},
		});
		const memory = createMemoryTransport();
		const connection = runtime.connect(memory.transport);

		memory.emit({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: "newer-room",
		});
		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_ERROR),
		);

		const errorMessage = memory.sent.find(
			(message) => message.type === DKT_MSG.RUNTIME_ERROR,
		) as { message?: unknown } | undefined;
		expect(errorMessage?.message).toContain("unsupported newer version");

		const workspaceStateMessage = memory.sent.find(
			(message) => message.type === DKT_MSG.WORKSPACE_OPEN_STATE,
		) as
			| {
					state?: { status?: unknown; failureReason?: unknown };
					failureReasonLabel?: unknown;
			  }
			| undefined;
		expect(workspaceStateMessage).toMatchObject({
			state: {
				status: WORKSPACE_OPEN_STATUS.FAILED,
				failureReason: WORKSPACE_OPEN_FAILURE.UNSUPPORTED_NEWER_VERSION,
			},
			failureReasonLabel: "unsupported_newer_version",
		});

		const dump = (await runtime.debugDumpState()) as {
			booted?: unknown;
			workspaceOpenState?: { status?: unknown; failureReason?: unknown } | null;
			runtimeModels?: readonly { modelName?: string | null }[];
		};
		expect(dump.booted).toBe(false);
		expect(dump.workspaceOpenState).toEqual({
			status: WORKSPACE_OPEN_STATUS.FAILED,
			failureReason: WORKSPACE_OPEN_FAILURE.UNSUPPORTED_NEWER_VERSION,
		});
		expect(
			dump.runtimeModels?.filter(
				(model) => model.modelName === "session_root" || model.modelName === "project",
			) ?? [],
		).toHaveLength(0);

		connection.destroy();
		await storagePackage.close?.();
	});

	it("boots with IndexedDB CRDT storage for browser workers", async () => {
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				testOnly: true,
				peerId: "worker-crdt-indexeddb",
				storage: {
					type: "indexeddb",
					dbName: `minicut-worker-crdt-${Date.now()}`,
					indexedDB,
				},
				transport: null,
			},
		});

		const dump = await runtime.debugDumpState();

		expect(dump.crdt).toMatchObject({
			enabled: true,
			peerId: "worker-crdt-indexeddb",
			durableLogCount: 0,
			hasRegistry: true,
		});
	});

	it("enables production CRDT runtime with default IndexedDB storage", async () => {
		const runtime = createMiniCutDktRuntime({
			enabled: true,
			crdt: {
				enabled: true,
				peerId: `worker-crdt-production-${Date.now()}`,
				storage: {
					type: "indexeddb",
					dbName: `minicut-worker-crdt-production-${Date.now()}`,
					indexedDB,
				},
				transport: null,
			},
		});

		const dump = await runtime.debugDumpState();

		expect(dump.crdt).toMatchObject({
			enabled: true,
			hasRegistry: true,
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
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
