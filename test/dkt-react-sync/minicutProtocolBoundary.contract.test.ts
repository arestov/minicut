import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import { describe, expect, it } from "vitest";
import { defineShape } from "@dkt-react-sync/shape/defineShape";
import { MemoryWorkerAuthority } from "../../src/video-editor/worker/memoryWorker";
import { createMiniCutPageSyncRuntime } from "../../src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../../src/video-editor/dkt/shared/messageTypes";
import { waitFor } from "./testUtils";

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

const emitRoot = (
	emit: (message: MiniCutDktTransportMessage) => void,
	rootNodeId: string,
	sessionKey: string,
) => {
	emit({ type: DKT_MSG.RUNTIME_READY, rootNodeId, sessionKey });
	emit({
		type: DKT_MSG.SYNC_HANDLE,
		syncType: SYNCR_TYPES.SET_DICT,
		payload: [undefined, "name"],
	});
	emit({
		type: DKT_MSG.SYNC_HANDLE,
		syncType: SYNCR_TYPES.TREE_ROOT,
		payload: { node_id: rootNodeId, data: [null, null, null] },
	});
};

describe("MiniCut DKT React sync protocol boundary", () => {
	it("uses one stable activation id for mount and unmount", () => {
		const memory = createMemoryTransport();
		const pageRuntime = createMiniCutPageSyncRuntime({
			transport: memory.transport,
		});
		const shape = defineShape({ attrs: ["name"] });

		emitRoot(memory.emit, "root-1", "session-1");
		const rootScope = pageRuntime.getRootScope();
		if (!rootScope) {
			throw new Error("Expected root scope");
		}
		const stop = pageRuntime.mountShape(rootScope, shape);
		stop();

		const requests = memory.sent.filter(
			(message) => message.type === DKT_MSG.SYNC_REQUIRE_SHAPE,
		);
		expect(requests).toEqual([
			{
				type: DKT_MSG.SYNC_REQUIRE_SHAPE,
				data: {
					node_id: "root-1",
					activation_id: "react-shape-registry:root-1",
					shape_ids: [shape.id],
				},
			},
			{
				type: DKT_MSG.SYNC_REQUIRE_SHAPE,
				data: {
					node_id: "root-1",
					activation_id: "react-shape-registry:root-1",
					shape_ids: [],
				},
			},
		]);
		pageRuntime.destroy();
	});

	it("republishes shapes and requests them for a rebootstrap root", () => {
		const memory = createMemoryTransport();
		const pageRuntime = createMiniCutPageSyncRuntime({
			transport: memory.transport,
		});
		const shape = defineShape({ attrs: ["name"] });

		emitRoot(memory.emit, "root-1", "session-1");
		const firstRoot = pageRuntime.getRootScope();
		if (!firstRoot) {
			throw new Error("Expected first root scope");
		}
		pageRuntime.mountShape(firstRoot, shape);

		pageRuntime.bootstrap({ sessionKey: "session-2" });
		emitRoot(memory.emit, "root-2", "session-2");
		const secondRoot = pageRuntime.getRootScope();
		if (!secondRoot) {
			throw new Error("Expected second root scope");
		}
		pageRuntime.mountShape(secondRoot, shape);

		expect(
			memory.sent.filter(
				(message) => message.type === DKT_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
			),
		).toHaveLength(2);
		expect(
			memory.sent
				.filter((message) => message.type === DKT_MSG.SYNC_REQUIRE_SHAPE)
				.map((message) => message.data),
		).toEqual(
			expect.arrayContaining([
				{
					node_id: "root-1",
					activation_id: "react-shape-registry:root-1",
					shape_ids: [shape.id],
				},
				{
					node_id: "root-2",
					activation_id: "react-shape-registry:root-2",
					shape_ids: [shape.id],
				},
			]),
		);
		pageRuntime.destroy();
	});

	it("rejects the legacy array payload instead of silently dropping it", async () => {
		const authority = new MemoryWorkerAuthority();
		const transport = authority.openDktTransport();
		const received: MiniCutDktTransportMessage[] = [];
		const unlisten = transport.listen((message) => received.push(message));

		try {
			transport.send({
				type: DKT_MSG.BOOTSTRAP,
				sessionKey: "legacy-shape-request-contract",
			});
			await waitFor(() =>
				received.some((message) => message.type === DKT_MSG.RUNTIME_READY),
			);
			transport.send({
				type: DKT_MSG.SYNC_REQUIRE_SHAPE,
				data: ["1", "shape-legacy"],
			} as unknown as MiniCutDktTransportMessage);
			await waitFor(() =>
				received.some((message) => message.type === DKT_MSG.RUNTIME_ERROR),
			);

			const runtimeError = received.find(
				(message) => message.type === DKT_MSG.RUNTIME_ERROR,
			);
			expect(runtimeError).toMatchObject({ type: DKT_MSG.RUNTIME_ERROR });
			expect(String(runtimeError && "message" in runtimeError ? runtimeError.message : ""))
				.toContain("Invalid DKT sync shape request payload");
		} finally {
			unlisten();
			transport.destroy();
			authority.destroy();
		}
	});
});
