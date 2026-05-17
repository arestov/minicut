import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import { describe, expect, it } from "vitest";
import { defineShape } from "../../../dkt-react-sync/shape/defineShape";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { createMiniCutPageSyncRuntime } from "./createMiniCutPageSyncRuntime";

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

const emitRootProject = (
	emit: (message: MiniCutDktTransportMessage) => void,
) => {
	emit({
		type: DKT_MSG.RUNTIME_READY,
		sessionKey: "session:1",
		rootNodeId: "root",
	});
	emit({
		type: DKT_MSG.SYNC_HANDLE,
		syncType: SYNCR_TYPES.SET_DICT,
		payload: [undefined, "name", "tracks"],
	});
	emit({
		type: DKT_MSG.SYNC_HANDLE,
		syncType: SYNCR_TYPES.TREE_ROOT,
		payload: { node_id: "root", data: [null, null, null] },
	});
	emit({
		type: DKT_MSG.SYNC_HANDLE,
		syncType: SYNCR_TYPES.UPDATE,
		payload: [0, "root", 2, 1, "Project 1", 1, "root", 2, ["track-1"]],
	});
};

describe("createMiniCutPageSyncRuntime", () => {
	it("bootstraps and exposes root attrs/scopes from DKT sync messages", () => {
		const memory = createMemoryTransport();
		const runtime = createMiniCutPageSyncRuntime({
			transport: memory.transport,
		});

		runtime.bootstrap({ sessionKey: "session:1" });
		emitRootProject(memory.emit);

		expect(memory.sent[0]).toEqual({
			type: DKT_MSG.BOOTSTRAP,
			sessionKey: "session:1",
		});
		expect(runtime.getSnapshot()).toMatchObject({
			booted: true,
			ready: true,
			sessionKey: "session:1",
			rootNodeId: "root",
		});
		expect(runtime.getRootScope()?._nodeId).toBe("root");
		expect(runtime.getRootAttrs(["name"]).name).toBe("Project 1");
		const rootScope = runtime.getRootScope();
		if (!rootScope) {
			throw new Error("Expected root scope");
		}
		expect(
			runtime.readMany(rootScope, "tracks").map((scope) => scope._nodeId),
		).toEqual(["track-1"]);
	});

	it("notifies many subscribers when an initially empty rel is updated later", () => {
		const memory = createMemoryTransport();
		const runtime = createMiniCutPageSyncRuntime({
			transport: memory.transport,
		});

		memory.emit({
			type: DKT_MSG.RUNTIME_READY,
			sessionKey: "session:1",
			rootNodeId: "root",
		});
		memory.emit({
			type: DKT_MSG.SYNC_HANDLE,
			syncType: SYNCR_TYPES.SET_DICT,
			payload: [undefined, "tracks"],
		});
		memory.emit({
			type: DKT_MSG.SYNC_HANDLE,
			syncType: SYNCR_TYPES.TREE_ROOT,
			payload: { node_id: "root", data: [null, null, null] },
		});

		const rootScope = runtime.getRootScope();
		if (!rootScope) {
			throw new Error("Expected root scope");
		}
		const notifications: string[][] = [];
		const stop = runtime.subscribeMany(rootScope, "tracks", () => {
			notifications.push(
				runtime.readMany(rootScope, "tracks").map((scope) => scope._nodeId),
			);
		});

		expect(runtime.readMany(rootScope, "tracks")).toEqual([]);

		memory.emit({
			type: DKT_MSG.SYNC_HANDLE,
			syncType: SYNCR_TYPES.UPDATE,
			payload: [1, "root", 1, ["track-1"]],
		});

		expect(notifications).toEqual([["track-1"]]);
		expect(
			runtime.readMany(rootScope, "tracks").map((scope) => scope._nodeId),
		).toEqual(["track-1"]);

		stop();
	});

	it("emits scoped dispatch and shape transport messages", () => {
		const memory = createMemoryTransport();
		const runtime = createMiniCutPageSyncRuntime({
			transport: memory.transport,
		});
		const shape = defineShape({ attrs: ["name"] });

		emitRootProject(memory.emit);

		const rootScope = runtime.getRootScope();
		if (!rootScope) {
			throw new Error("Expected root scope");
		}
		const stopShape = runtime.mountShape(rootScope, shape);
		runtime.getDispatch(rootScope)("rename", { name: "Project 2" });
		runtime.getDispatch(rootScope)("previewMoveBy", { delta: 1 }, {
			intent: { batch_id: "clip-drag:1" },
		});
		stopShape();

		expect(memory.sent).toContainEqual({
			type: DKT_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
			data: {
				graph: {
					[shape.id]: {
						id: shape.id,
						t: 0,
						a: ["name"],
						r: undefined,
					},
				},
			},
		});
		expect(memory.sent).toContainEqual({
			type: DKT_MSG.SYNC_REQUIRE_SHAPE,
			data: ["root", shape.id],
		});
		expect(memory.sent).toContainEqual({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: "rename",
			payload: { name: "Project 2" },
			scopeNodeId: "root",
		});
		expect(memory.sent).toContainEqual({
			type: DKT_MSG.DISPATCH_ACTION,
			actionName: "previewMoveBy",
			payload: { delta: 1 },
			scopeNodeId: "root",
			meta: { intent: { batch_id: "clip-drag:1" } },
		});
	});

	it("waits for runtime settle through the worker idle handshake", async () => {
		const memory = createMemoryTransport();
		const runtime = createMiniCutPageSyncRuntime({
			transport: memory.transport,
		});

		const settlePromise = runtime.waitForRuntimeSettled?.();
		if (!settlePromise) {
			throw new Error("Expected waitForRuntimeSettled");
		}

		await expect
			.poll(
				() => memory.sent.some((message) => message.type === DKT_MSG.WAIT_IDLE),
				{
					timeout: 5_000,
				},
			)
			.toBe(true);

		const waitMessage = memory.sent.find(
			(message) => message.type === DKT_MSG.WAIT_IDLE,
		) as { requestId?: string } | undefined;
		expect(waitMessage?.requestId).toMatch(/^idle:/);

		memory.emit({
			type: DKT_MSG.IDLE,
			requestId: waitMessage?.requestId,
		});

		await settlePromise;
	});
});
