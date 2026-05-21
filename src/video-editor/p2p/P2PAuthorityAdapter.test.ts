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
		openServerCrdt(remotePeerId: string, transport: P2PCrdtTransportLike) {
			eventsRef?.onServerCrdtTransport?.(remotePeerId, transport);
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

		expect(manager.authorityTransport.destroy).not.toHaveBeenCalled();
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
		expect(manager.authorityTransport.destroy).toHaveBeenCalledTimes(1);
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
		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_PEER_ATTACHED,
				roomId: "room-1",
				transportGeneration: 7,
				peerId: "server",
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
		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_PEER_ATTACHED,
				roomId: "room-1",
				transportGeneration: 3,
				peerId: "server",
			}),
		);
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

	it("queues worker CRDT sends until a late CRDT channel opens", () => {
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
				transportGeneration: 9,
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 9,
				packet: { queued: true },
			}),
		);

		expect(crdtTransport.sent).toEqual([]);
		manager.openClientCrdt(crdtTransport);
		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_PEER_ATTACHED,
				roomId: "room-1",
				transportGeneration: 9,
				peerId: "server",
			}),
		);
		expect(crdtTransport.sent).toEqual([{ queued: true }]);

		dktTransport.destroy();
		adapter.destroy();
	});

	it("queues CRDT sends while the test partition is enabled and flushes on heal", () => {
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
		const localTransport = localAuthority.opened[0];
		expect(localTransport).toBeTruthy();

		const crdtTransport = createCrdtTransportHarness();
		manager.openClientCrdt(crdtTransport);
		localTransport.emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId: "room-1",
				transportGeneration: 12,
			}),
		);

		expect(adapter.setCrdtNetworkPartitionTesting?.(true)).toEqual({
			enabled: true,
		});
		localTransport.emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 12,
				packet: { partitioned: true },
			}),
		);
		expect(crdtTransport.sent).toEqual([]);

		expect(adapter.setCrdtNetworkPartitionTesting?.(false)).toEqual({
			enabled: false,
		});
		expect(crdtTransport.sent).toEqual([{ partitioned: true }]);

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

	it("broadcasts and targets CRDT packets across multiple remote peers", () => {
		const manager = createManagerHarness();
		const localAuthority = createLocalAuthorityHarness();
		const peerB = createCrdtTransportHarness();
		const peerC = createCrdtTransportHarness();
		const adapter = createP2PAuthorityAdapter({
			roomId: "room-1",
			signalUrl: "ws://127.0.0.1:8790",
			createManager: manager.createManager,
			createLocalAuthority: () => localAuthority,
		});
		const dktTransport = adapter.openDktTransport();
		manager.becomeClient();
		manager.openServerCrdt("peer-b", peerB);
		manager.openServerCrdt("peer-c", peerC);

		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId: "room-1",
				transportGeneration: 8,
			}),
		);
		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_PEER_ATTACHED,
				roomId: "room-1",
				transportGeneration: 8,
				peerId: "peer-b",
			}),
		);
		expect(localAuthority.opened[0].sent).toContainEqual(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_PEER_ATTACHED,
				roomId: "room-1",
				transportGeneration: 8,
				peerId: "peer-c",
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 8,
				packet: { broadcast: true },
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 8,
				packet: { targeted: true },
				targetPeerId: "peer-c",
			}),
		);

		expect(peerB.sent).toEqual([{ broadcast: true }]);
		expect(peerC.sent).toEqual([{ broadcast: true }, { targeted: true }]);

		dktTransport.destroy();
		adapter.destroy();
	});

	it("handles opaque CRDT packet faults without inspecting payloads", () => {
		const manager = createManagerHarness();
		const localAuthority = createLocalAuthorityHarness();
		const peerB = createCrdtTransportHarness();
		const peerC = createCrdtTransportHarness();
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
				transportGeneration: 11,
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 10,
				packet: { staleGeneration: true },
			}),
		);
		localAuthority.opened[0].emit(
			productRoomMessage({
				type: PRODUCT_ROOM_MSG.CRDT_SEND,
				roomId: "room-1",
				transportGeneration: 11,
				packet: { targetedLate: true },
				targetPeerId: "peer-c",
			}),
		);
		expect(peerC.sent).toEqual([]);

		manager.openServerCrdt("peer-b", peerB);
		peerB.emit({ seq: 2, payload: { nested: ["opaque"] } }, "peer-b");
		peerB.emit({ seq: 1, payload: { nested: ["opaque"] } }, "peer-b");
		peerB.emit({ seq: 1, payload: { nested: ["opaque"] } }, "peer-b");
		manager.openServerCrdt("peer-c", peerC);

		expect(peerB.sent).toEqual([]);
		expect(peerC.sent).toEqual([{ targetedLate: true }]);
		expect(localAuthority.opened[0].sent).toEqual(
			expect.arrayContaining([
				productRoomMessage({
					type: PRODUCT_ROOM_MSG.CRDT_RECEIVE,
					roomId: "room-1",
					transportGeneration: 11,
					packet: { seq: 2, payload: { nested: ["opaque"] } },
					sourcePeerId: "peer-b",
				}),
				productRoomMessage({
					type: PRODUCT_ROOM_MSG.CRDT_RECEIVE,
					roomId: "room-1",
					transportGeneration: 11,
					packet: { seq: 1, payload: { nested: ["opaque"] } },
					sourcePeerId: "peer-b",
				}),
			]),
		);
		expect(
			localAuthority.opened[0].sent.filter(
				(message) =>
					message.type === DKT_MSG.PRODUCT_ROOM_MESSAGE &&
					message.message.type === PRODUCT_ROOM_MSG.CRDT_RECEIVE &&
					(message.message.packet as { seq?: number }).seq === 1,
			),
		).toHaveLength(2);

		dktTransport.destroy();
		adapter.destroy();
	});
});
