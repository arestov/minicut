import { describe, expect, it } from "vitest";
import { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import { createTestWorkerCrdtTransport } from "./createTestWorkerCrdtTransport";

describe("createInMemoryCrdtRelay", () => {
	it("broadcasts packets to other peers in the room without echoing sender", () => {
		const relay = createInMemoryCrdtRelay();
		const a = createTestWorkerCrdtTransport({
			relay,
			roomId: "room-basic",
			peerId: "A",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		const b = createTestWorkerCrdtTransport({
			relay,
			roomId: "room-basic",
			peerId: "B",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});

		a.sendOps({ ops: [{ op_id: "op:1", value: "title" }] });

		expect(a.received).toEqual([]);
		expect(b.received).toEqual([
			expect.objectContaining({
				type: "crdt-ops",
				from: "A",
				packet: expect.objectContaining({ peerId: "A" }),
			}),
		]);
	});

	it("rejects spoofed senders and profile mismatches", () => {
		const relay = createInMemoryCrdtRelay();
		createTestWorkerCrdtTransport({
			relay,
			roomId: "room-guard",
			peerId: "A",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});

		expect(() =>
			relay.dispatch({
				type: "crdt-ops",
				roomId: "room-guard",
				from: "A",
				packet: {
					profileId: "minicut-crdt-v1",
					profileVersion: 1,
					peerId: "B",
					ops: [],
				},
			}),
		).toThrow("spoofed");

		expect(() =>
			createTestWorkerCrdtTransport({
				relay,
				roomId: "room-guard",
				peerId: "B",
				profileId: "minicut-crdt-v2",
				profileVersion: 1,
			}),
		).toThrow("profile mismatch");
	});

	it("dedupes repeated packet ids and keeps a bounded sync log", () => {
		const relay = createInMemoryCrdtRelay({ maxLogPackets: 2 });
		const a = createTestWorkerCrdtTransport({
			relay,
			roomId: "room-log",
			peerId: "A",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		const b = createTestWorkerCrdtTransport({
			relay,
			roomId: "room-log",
			peerId: "B",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});

		a.sendOps({ ops: [{ op_id: "op:1", value: 1 }] });
		a.sendOps({ ops: [{ op_id: "op:1", value: 1 }] });
		a.sendOps({ ops: [{ op_id: "op:2", value: 2 }] });
		a.sendOps({ ops: [{ op_id: "op:3", value: 3 }] });

		expect(b.received.filter((message) => message.type === "crdt-ops"))
			.toHaveLength(3);
		expect(relay.getRoomSnapshot("room-log").log).toHaveLength(2);

		b.requestSync("sync:1", {});
		const sync = b.received.find(
			(message) => message.type === "crdt-sync-response",
		);
		expect(sync).toMatchObject({
			type: "crdt-sync-response",
			to: "B",
			requestId: "sync:1",
			packet: {
				ops: [
					expect.objectContaining({ op_id: "op:2" }),
					expect.objectContaining({ op_id: "op:3" }),
				],
			},
		});
	});

	it("removes peers on close", () => {
		const relay = createInMemoryCrdtRelay();
		const a = createTestWorkerCrdtTransport({
			relay,
			roomId: "room-close",
			peerId: "A",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		expect(relay.getRoomSnapshot("room-close").peers).toEqual(["A"]);

		a.close();

		expect(relay.getRoomSnapshot("room-close").peers).toEqual([]);
	});
});
