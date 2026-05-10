import { describe, expect, it } from "vitest";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { createMiniCutDktWorkerModelRuntime } from "./workerModelRuntime";

const waitFor = async (predicate: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
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

describe("createMiniCutDktWorkerModelRuntime", () => {
	it("tracks model sessions per worker connection", async () => {
		const workerRuntime = createMiniCutDktWorkerModelRuntime();
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
		const workerRuntime = createMiniCutDktWorkerModelRuntime();
		const memory = createMemoryTransport();
		const connection = workerRuntime.connect(memory.transport);

		memory.emit({ type: DKT_MSG.BOOTSTRAP, sessionKey: "session:idle" });
		await waitFor(() =>
			memory.sent.some((message) => message.type === DKT_MSG.RUNTIME_READY),
		);

		memory.emit({ type: DKT_MSG.WAIT_IDLE, requestId: "idle:request-1" });

		await waitFor(() =>
			memory.sent.some(
				(message) =>
					message.type === DKT_MSG.IDLE &&
					(message as { requestId?: string }).requestId === "idle:request-1",
			),
		);

		expect(memory.sent).toContainEqual({
			type: DKT_MSG.IDLE,
			requestId: "idle:request-1",
		});

		connection.destroy();
	});
});
