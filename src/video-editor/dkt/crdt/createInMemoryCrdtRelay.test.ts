import { describe, expect, it } from "vitest";
import { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import { createMiniCutRoomCrdtTransport } from "./createMiniCutRoomCrdtTransport";
import { createTestWorkerCrdtTransport } from "./createTestWorkerCrdtTransport";

const makeWireMessage = (from: string) => ({
	type: "dkt-crdt-batches" as const,
	protocol: "dkt-crdt-graph-v1" as const,
	from,
	profile_id: "minicut-crdt-v1",
	profile_version: 1,
	future_field: { keep: true },
	batches: [
		{
			schema_version: 1,
			batch_id: `${from}:batch:1`,
			origin_peer_id: from,
			runtime_transaction_id: "tx:1",
			intent: null,
			clock: { wall_time: 1, counter: 1, peer_id: from },
			created_models: [{ node_id: "crdt:child", model_name: "clip", tombstone: false }],
			tombstones: [],
			action_trace: {
				trace_version: 1,
				frames: [{ frame_id: 1, frame_kind: "action", action_name: "addClip" }],
				produced_ops: [
					{
						frame_id: 1,
						op_id: `${from}:op:1`,
						kind: "attr",
						node_id: "crdt:child",
						model_name: "clip",
						field_name: "name",
					},
				],
				produced_creates: [{ frame_id: 1, node_id: "crdt:child", model_name: "clip" }],
				read_fingerprints: [
					{
						frame_id: 1,
						node_id: "crdt:project",
						model_name: "project",
						field_kind: "attr",
						field_name: "title",
						policy: "crdt",
						value_hash: "hash",
						value_json: "\"Project\"",
					},
				],
			},
			ops: [
				{
					op_id: `${from}:op:1`,
					origin: from,
					peer_id: from,
					seq: 1,
					node_id: "crdt:child",
					model_name: "clip",
					field_id: "clip:name",
					kind: "attr",
					name: "name",
					operation: "set",
					clock: { wall_time: 1, counter: 1, peer_id: from },
					value: "Clip",
				},
			],
		},
	],
});

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

	it("implements DKT send/subscribe/close and preserves opaque wire payloads", () => {
		const relay = createInMemoryCrdtRelay();
		const a = createMiniCutRoomCrdtTransport({
			relay,
			roomId: "room-dkt-wire",
			peerId: "A",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		const b = createMiniCutRoomCrdtTransport({
			relay,
			roomId: "room-dkt-wire",
			peerId: "B",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});
		const received: unknown[] = [];
		const unsubscribe = b.subscribe((message) => received.push(message));

		a.send(makeWireMessage("A"));

		expect(received).toEqual([makeWireMessage("A")]);
		expect(JSON.parse(JSON.stringify(received[0]))).toEqual(received[0]);
		expect(a.received).toEqual([]);
		expect(relay.getRoomSnapshot("room-dkt-wire").log[0]?.payload).toEqual(
			makeWireMessage("A"),
		);

		unsubscribe();
		a.send({ ...makeWireMessage("A"), batches: [{ ...makeWireMessage("A").batches[0], batch_id: "A:batch:2" }] });
		expect(received).toHaveLength(1);
		b.close();
		expect(relay.getRoomSnapshot("room-dkt-wire").peers).toEqual(["A"]);
		a.close();
	});

	it("rejects spoofed DKT senders and transport profile mismatches", () => {
		const relay = createInMemoryCrdtRelay();
		const a = createMiniCutRoomCrdtTransport({
			relay,
			roomId: "room-dkt-guard",
			peerId: "A",
			profileId: "minicut-crdt-v1",
			profileVersion: 1,
		});

		expect(() => a.send({ ...makeWireMessage("B"), from: "B" })).toThrow(
			"spoofed",
		);
		expect(() =>
			a.send({ ...makeWireMessage("A"), profile_id: "other-profile" }),
		).toThrow("profile mismatch");
		a.close();
	});
});
