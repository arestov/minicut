import { describe, expect, it, vi } from "vitest";
import {
	DKT_TEST_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { createMiniCutDktTestRuntimeProtocol } from "./createMiniCutDktTestRuntimeProtocol";

const createProtocol = (debugDumpState: () => Promise<unknown> | unknown) =>
	createMiniCutDktTestRuntimeProtocol({
		bootstrapApp: async () => ({
			appModel: {},
			runtime: {},
		}),
		enqueueScopedAction: async () => {},
		debugDumpState: async () => debugDumpState(),
	});

describe("createMiniCutDktTestRuntimeProtocol", () => {
	it("reports debug dump send failures as request-scoped test errors", async () => {
		const protocol = createProtocol(() => ({ value: Promise.resolve(1) }));
		const sent: MiniCutDktTransportMessage[] = [];
		const transport = {
			send: vi.fn((message: MiniCutDktTransportMessage) => {
				if (message.type === DKT_TEST_MSG.DEBUG_DUMP_RESPONSE) {
					throw new DOMException("#<Promise> could not be cloned", "DataCloneError");
				}
				sent.push(message);
			}),
			listen: vi.fn(),
			destroy: vi.fn(),
		};

		await protocol.handle(
			{ type: DKT_TEST_MSG.DEBUG_DUMP_REQUEST, requestId: "dump:1" },
			transport,
			{ activeSessionKey: "session", activeSessionId: "session" },
		);

		expect(sent).toEqual([
			expect.objectContaining({
				type: DKT_TEST_MSG.ERROR,
				requestId: "dump:1",
				phase: "debug-dump",
				error: expect.objectContaining({
					name: "DataCloneError",
					message: "#<Promise> could not be cloned",
				}),
			}),
		]);
	});

	it("reports debug dump producer failures as request-scoped test errors", async () => {
		const protocol = createProtocol(() => {
			throw new Error("dump exploded");
		});
		const sent: MiniCutDktTransportMessage[] = [];
		const transport = {
			send: vi.fn((message: MiniCutDktTransportMessage) => {
				sent.push(message);
			}),
			listen: vi.fn(),
			destroy: vi.fn(),
		};

		await protocol.handle(
			{ type: DKT_TEST_MSG.DEBUG_DUMP_REQUEST, requestId: "dump:2" },
			transport,
			{ activeSessionKey: "session", activeSessionId: "session" },
		);

		expect(sent).toEqual([
			expect.objectContaining({
				type: DKT_TEST_MSG.ERROR,
				requestId: "dump:2",
				phase: "debug-dump",
				error: expect.objectContaining({ message: "dump exploded" }),
			}),
		]);
	});
});
