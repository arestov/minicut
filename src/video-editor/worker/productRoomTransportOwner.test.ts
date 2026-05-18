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
	const coordinator = createProductRoomTransportOwner({
		roomId: "room-a",
		heartbeatTimeoutMs: 100,
		createTransportOwnerToken: (tabId) => `token:${tabId}`,
		now: () => now,
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
				transportOwnerToken: "token:tab-a",
			},
		]);
		expect(harness.coordinator.getOwner()).toMatchObject({
			tabId: "tab-a",
			transportOwnerToken: "token:tab-a",
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
			transportOwnerToken: "token:tab-b",
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
			transportOwnerToken: "token:tab-b",
		});
	});

	it("re-elects after a room mismatch reject", () => {
		const harness = createHarness();
		harness.coordinator.setWorkspaceOpenState(readyState);
		harness.register("tab-a", true);
		harness.register("tab-b", true);

		harness.coordinator.handleOwnerStatus({
			type: PRODUCT_ROOM_MSG.WEBRTC_OWNER_STATUS,
			tabId: "tab-a",
			roomId: "room-a",
			transportOwnerToken: "token:tab-a",
			status: WEBRTC_OWNER_STATUS.REJECTED_ROOM_MISMATCH,
		});

		expect(harness.coordinator.getOwner()).toMatchObject({ tabId: "tab-b" });
		expect(harness.sent.get("tab-a")?.at(-1)).toMatchObject({
			type: PRODUCT_ROOM_MSG.DETACH_WEBRTC,
			transportOwnerToken: "token:tab-a",
		});
		expect(harness.sent.get("tab-b")?.at(-1)).toMatchObject({
			type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
			transportOwnerToken: "token:tab-b",
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
			transportOwnerToken: "token:tab-b",
		});
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
