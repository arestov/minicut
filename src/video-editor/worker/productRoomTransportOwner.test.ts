import { describe, expect, it } from "vitest";
import {
	WORKSPACE_OPEN_FAILURE,
	WORKSPACE_OPEN_STATUS,
	type WorkspaceOpenState,
} from "../dkt/runtime/workspaceOpenState";
import {
	PRODUCT_ROOM_MSG,
	WEBRTC_OWNER_STATUS,
	type ProductRoomProtocolMessage,
} from "./productRoomProtocol";
import { createProductRoomTransportOwner } from "./productRoomTransportOwner";

const readyState: WorkspaceOpenState = {
	status: WORKSPACE_OPEN_STATUS.READY,
	failureReason: WORKSPACE_OPEN_FAILURE.NONE,
};

const failedState: WorkspaceOpenState = {
	status: WORKSPACE_OPEN_STATUS.FAILED,
	failureReason: WORKSPACE_OPEN_FAILURE.STORAGE_ERROR,
};

const createHarness = () => {
	let now = 1_000;
	const sent = new Map<string, ProductRoomProtocolMessage[]>();
	const receivedCrdt: unknown[] = [];
	const coordinator = createProductRoomTransportOwner({
		roomId: "room-a",
		heartbeatTimeoutMs: 100,
		now: () => now,
		onCrdtPacket: (packet) => receivedCrdt.push(packet),
	});
	const register = (tabId: string, canHostWebRtc: boolean, roomId = "room-a") => {
		sent.set(tabId, []);
		coordinator.registerTab(
			{
				type: PRODUCT_ROOM_MSG.TAB_HELLO,
				tabId,
				roomId,
				canHostWebRtc,
			},
			(message) => sent.get(tabId)?.push(message),
		);
	};
	return {
		coordinator,
		sent,
		receivedCrdt,
		register,
		advance(ms: number) {
			now += ms;
		},
	};
};

describe("product room transport owner", () => {
	it("selects the first capable tab as WebRTC owner", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);

		harness.register("tab-a", true);

		expect(harness.sent.get("tab-a")).toEqual([
			{
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId: "room-a",
				transportGeneration: 1,
			},
		]);
		expect(harness.coordinator.getOwner()).toMatchObject({
			tabId: "tab-a",
			transportGeneration: 1,
		});
	});

	it("ignores incapable tabs", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);

		harness.register("tab-a", false);
		harness.register("tab-b", true);

		expect(harness.sent.get("tab-a")).toEqual([]);
		expect(harness.sent.get("tab-b")?.[0]).toMatchObject({
			type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
			transportGeneration: 1,
		});
	});

	it("selects the next capable tab after the owner closes", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);
		harness.register("tab-b", true);

		harness.coordinator.unregisterTab("tab-a");

		expect(harness.coordinator.getOwner()).toMatchObject({ tabId: "tab-b" });
		expect(harness.sent.get("tab-b")?.[0]).toMatchObject({
			type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
			transportGeneration: 2,
		});
	});

	it("re-elects after a room mismatch reject", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);
		harness.register("tab-b", true);

		harness.coordinator.handleOwnerStatus({
			type: PRODUCT_ROOM_MSG.WEBRTC_STATUS,
			tabId: "tab-a",
			roomId: "room-a",
			transportGeneration: 1,
			status: WEBRTC_OWNER_STATUS.REJECTED_ROOM_MISMATCH,
		});

		expect(harness.coordinator.getOwner()).toMatchObject({ tabId: "tab-b" });
		expect(harness.sent.get("tab-a")?.at(-1)).toMatchObject({
			type: PRODUCT_ROOM_MSG.DETACH_WEBRTC,
			transportGeneration: 1,
		});
		expect(harness.sent.get("tab-b")?.at(-1)).toMatchObject({
			type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
			transportGeneration: 2,
		});
	});

	it("re-elects after heartbeat timeout", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);
		harness.register("tab-b", true);

		harness.advance(101);
		harness.coordinator.expireOwnerLease();

		expect(harness.coordinator.getOwner()).toMatchObject({ tabId: "tab-b" });
		expect(harness.sent.get("tab-b")?.at(-1)).toMatchObject({
			type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
			transportGeneration: 2,
		});
	});

	it("ignores stale owner status", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);
		harness.register("tab-b", true);
		harness.coordinator.unregisterTab("tab-a");

		const result = harness.coordinator.handleOwnerStatus({
			type: PRODUCT_ROOM_MSG.WEBRTC_STATUS,
			tabId: "tab-a",
			roomId: "room-a",
			transportGeneration: 1,
			status: WEBRTC_OWNER_STATUS.FAILED,
		});

		expect(result).toEqual({ ok: false, errorCode: "tab_not_owner" });
		expect(harness.coordinator.getOwner()).toMatchObject({ tabId: "tab-b" });
	});

	it("rejects wrong-room CRDT receive messages", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);

		const result = harness.coordinator.handleCrdtReceive({
			type: PRODUCT_ROOM_MSG.CRDT_RECEIVE,
			tabId: "tab-a",
			roomId: "room-b",
			transportGeneration: 1,
			packet: { hello: 1 },
		});

		expect(result).toEqual({ ok: false, errorCode: "room_mismatch" });
		expect(harness.receivedCrdt).toEqual([]);
	});

	it("routes outgoing CRDT packet to the active owner", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);
		harness.coordinator.handleOwnerStatus({
			type: PRODUCT_ROOM_MSG.WEBRTC_STATUS,
			tabId: "tab-a",
			roomId: "room-a",
			transportGeneration: 1,
			status: WEBRTC_OWNER_STATUS.ATTACHED,
		});

		const result = harness.coordinator.sendCrdtPacket({ hello: 1 });

		expect(result).toEqual({ ok: true, generation: 1 });
		expect(harness.sent.get("tab-a")?.at(-1)).toEqual({
			type: PRODUCT_ROOM_MSG.CRDT_SEND,
			roomId: "room-a",
			transportGeneration: 1,
			packet: { hello: 1 },
			targetPeerId: undefined,
		});
	});

	it("queues outgoing CRDT packet until an owner is attached", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);

		expect(harness.coordinator.sendCrdtPacket({ hello: 1 })).toEqual({
			ok: true,
			generation: 0,
		});
		harness.register("tab-a", true);
		expect(harness.sent.get("tab-a")).toEqual([
			{
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId: "room-a",
				transportGeneration: 1,
			},
		]);
		harness.coordinator.handleOwnerStatus({
			type: PRODUCT_ROOM_MSG.WEBRTC_STATUS,
			tabId: "tab-a",
			roomId: "room-a",
			transportGeneration: 1,
			status: WEBRTC_OWNER_STATUS.ATTACHED,
		});

		expect(harness.sent.get("tab-a")?.at(-1)).toEqual({
			type: PRODUCT_ROOM_MSG.CRDT_SEND,
			roomId: "room-a",
			transportGeneration: 1,
			packet: { hello: 1 },
			targetPeerId: undefined,
		});
	});

	it("delivers incoming CRDT packet from the active owner", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);

		expect(
			harness.coordinator.handleCrdtReceive({
				type: PRODUCT_ROOM_MSG.CRDT_RECEIVE,
				tabId: "tab-a",
				roomId: "room-a",
				transportGeneration: 1,
				packet: { hello: 1 },
				sourcePeerId: "peer-b",
			}),
		).toEqual({ ok: true });
		expect(harness.receivedCrdt).toEqual([
			{
				payload: { hello: 1 },
				sourcePeerId: "peer-b",
				transportGeneration: 1,
				roomId: "room-a",
			},
		]);
	});

	it("does not attach transport owner when workspace open failed", () => {
		const harness = createHarness();

		harness.coordinator.setWorkspaceOpenState(failedState);
		harness.register("tab-a", true);

		expect(harness.sent.get("tab-a")).toEqual([]);
		expect(harness.coordinator.getOwner()).toBeNull();
	});

	it("does not switch owners based on visibility or focus metadata", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);
		harness.register("tab-b", true);

		expect(harness.coordinator.getOwner()).toMatchObject({ tabId: "tab-a" });
		expect(harness.sent.get("tab-b")).toEqual([]);
	});
});
