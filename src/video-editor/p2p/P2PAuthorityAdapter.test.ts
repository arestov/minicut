import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import { describe, expect, it, vi } from "vitest";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../dkt/shared/messageTypes";
import {
	PRODUCT_ROOM_MSG,
	WEBRTC_OWNER_STATUS,
	type ProductRoomProtocolMessage,
} from "../worker/productRoomProtocol";
import type { EditorAuthorityClient } from "../worker/authorityClient";
import { createP2PAuthorityAdapter } from "./P2PAuthorityAdapter";
import type {
	P2PCrdtTransportLike,
	P2PTransportLike,
	PageP2PManager,
	PageP2PManagerConfig,
	PageP2PManagerEvents,
} from "./PageP2PManager";

const createMemoryDktTransport = () => {
	const listeners = new Set<(message: MiniCutDktTransportMessage) => void>();
	const sent: MiniCutDktTransportMessage[] = [];
	const transport: DomSyncTransportLike<MiniCutDktTransportMessage> = {
		send(message) {
			sent.push(message);
		},
		listen(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		destroy() {
			listeners.clear();
		},
	};
	return {
		transport,
		sent,
		emit(message: MiniCutDktTransportMessage) {
			for (const listener of [...listeners]) {
				listener(message);
			}
		},
	};
};

const createLocalAuthorityHarness = (): EditorAuthorityClient & {
	opened: ReturnType<typeof createMemoryDktTransport>[];
} => {
	const opened: ReturnType<typeof createMemoryDktTransport>[] = [];
	return {
		opened,
		openDktTransport() {
			const next = createMemoryDktTransport();
			opened.push(next);
			return next.transport;
		},
		destroy: vi.fn(),
	};
};

const createCrdtTransportHarness = (): P2PCrdtTransportLike & {
	sent: unknown[];
	destroyed: boolean;
	emit(packet: unknown, remotePeerId?: string): void;
} => {
	const listeners = new Set<(packet: unknown, remotePeerId: string) => void>();
	return {
		sent: [],
		destroyed: false,
		send(packet) {
			this.sent.push(packet);
		},
		listen(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		destroy() {
			this.destroyed = true;
			listeners.clear();
		},
		emit(packet, remotePeerId = "peer-b") {
			for (const listener of [...listeners]) {
				listener(packet, remotePeerId);
			}
		},
	};
};

const createManagerHarness = () => {
	let eventsRef: PageP2PManagerEvents | null = null;
	const authorityTransport: P2PTransportLike = {
		send: vi.fn(),
		listen: vi.fn(() => () => undefined),
		destroy: vi.fn(),
	};
	const manager: PageP2PManager = {
		role: "undecided",
		peerId: "tab-a",
		destroy: vi.fn(),
	};
	return {
		authorityTransport,
		manager,
		createManager(_config: PageP2PManagerConfig, events: PageP2PManagerEvents) {
			eventsRef = events;
			return manager;
		},
		becomeClient() {
			eventsRef?.onBecomeClient(authorityTransport);
		},
		openClientCrdt(transport: P2PCrdtTransportLike) {
			eventsRef?.onClientCrdtTransport?.(transport);
		},
	};
};

const productRoomMessage = (
	message: ProductRoomProtocolMessage,
): MiniCutDktTransportMessage => ({
	type: DKT_MSG.PRODUCT_ROOM_MESSAGE,
	message,
});

describe("P2PAuthorityAdapter CRDT worker bridge", () => {
	it("keeps client tabs on a local authority and uses WebRTC only for CRDT packets", () => {
		const manager = createManagerHarness();
		const localAuthority = createLocalAuthorityHarness();
		const adapter = createP2PAuthorityAdapter({
			roomId: "room-1",
			signalUrl: "ws://127.0.0.1:8790",
			createManager: manager.createManager,
			createLocalAuthority: () => localAuthority,
		});
		const dktTransport = adapter.openDktTransport();

		manager.becomeClient();

		expect(manager.authorityTransport.destroy).toHaveBeenCalledTimes(1);
		expect(localAuthority.opened).toHaveLength(1);
		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.TAB_HELLO,
				tabId: "tab-a",
				roomId: "room-1",
				canHostWebRtc: true,
			}),
		);

		dktTransport.destroy();
		adapter.destroy();
	});

	it("sends worker CRDT packets over the active WebRTC CRDT transport", () => {
		const manager = createManagerHarness();
		const localAuthority = createLocalAuthorityHarness();
		const crdtTransport = createCrdtTransportHarness();
		const adapter = createP2PAuthorityAdapter({
			roomId: "room-1",
			signalUrl: "ws://127.0.0.1:8790",
			createManager: manager.createManager,
			createLocalAuthority: () => localAuthority,
		});
		const dktTransport = adapter.openDktTransport();
		manager.becomeClient();
		manager.openClientCrdt(crdtTransport);

		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId: "room-1",
				transportGeneration: 7,
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 7,
				packet: { batch: [1] },
			}),
		);

		expect(crdtTransport.sent).toEqual([{ batch: [1] }]);
		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.WEBRTC_STATUS,
				tabId: "tab-a",
				roomId: "room-1",
				transportGeneration: 7,
				status: WEBRTC_OWNER_STATUS.ATTACHED,
			}),
		);

		dktTransport.destroy();
		adapter.destroy();
	});

	it("delivers remote CRDT packets to the worker after a late CRDT channel open", () => {
		const manager = createManagerHarness();
		const localAuthority = createLocalAuthorityHarness();
		const crdtTransport = createCrdtTransportHarness();
		const adapter = createP2PAuthorityAdapter({
			roomId: "room-1",
			signalUrl: "ws://127.0.0.1:8790",
			createManager: manager.createManager,
			createLocalAuthority: () => localAuthority,
		});
		const dktTransport = adapter.openDktTransport();
		manager.becomeClient();

		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId: "room-1",
				transportGeneration: 3,
			}),
		);
		manager.openClientCrdt(crdtTransport);
		crdtTransport.emit({ batch: [2] }, "peer-b");

		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_RECEIVE,
				roomId: "room-1",
				transportGeneration: 3,
				packet: { batch: [2] },
				sourcePeerId: "peer-b",
			}),
		);

		dktTransport.destroy();
		adapter.destroy();
	});

	it("ignores stale generation CRDT sends after detach", () => {
		const manager = createManagerHarness();
		const localAuthority = createLocalAuthorityHarness();
		const crdtTransport = createCrdtTransportHarness();
		const adapter = createP2PAuthorityAdapter({
			roomId: "room-1",
			signalUrl: "ws://127.0.0.1:8790",
			createManager: manager.createManager,
			createLocalAuthority: () => localAuthority,
		});
		const dktTransport = adapter.openDktTransport();
		manager.becomeClient();
		manager.openClientCrdt(crdtTransport);

		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId: "room-1",
				transportGeneration: 4,
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.DETACH_WEBRTC,
				roomId: "room-1",
				transportGeneration: 4,
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 4,
				packet: { stale: true },
			}),
		);

		expect(crdtTransport.sent).toEqual([]);

		dktTransport.destroy();
		adapter.destroy();
	});
});
