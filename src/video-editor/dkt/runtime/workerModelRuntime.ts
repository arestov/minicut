import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { PRODUCT_ROOM_MSG, type ProductRoomProtocolMessage } from "../../worker/productRoomProtocol";
import { createProductRoomTransportOwner } from "../../worker/productRoomTransportOwner";
import type { DktCrdtTransport, DktCrdtWireMessage } from "../crdt/testRelayContracts";
import {
	createMiniCutHarnessWorkspaceId,
	createMiniCutRoomPeerId,
	createMiniCutWorkspaceDbName,
} from "../storage/minicutWorkspaceManifest";
import {
	createMiniCutDktRuntime,
	type MiniCutCrdtTransport,
} from "./createMiniCutDktRuntime";

const cloneWireMessage = (message: DktCrdtWireMessage): DktCrdtWireMessage =>
	JSON.parse(JSON.stringify(message)) as DktCrdtWireMessage;

const createPageBridgeCrdtTransport = (): MiniCutCrdtTransport => ({
	attach(
		crdtRuntime,
		context,
	): () => void {
		const listeners = new Set<(message: DktCrdtWireMessage) => void>();
		const transport: DktCrdtTransport = {
			send(message: DktCrdtWireMessage): void {
				context.sendToPage({
					type: DKT_MSG.CRDT_TRANSPORT_SEND,
					peerId: context.peerId,
					profileId: context.profileId,
					profileVersion: context.profileVersion,
					message: cloneWireMessage(message),
				});
			},
			subscribe(listener: (message: DktCrdtWireMessage) => void): () => void {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			close(): void {
				listeners.clear();
			},
		};
		const unsubscribePage = context.subscribePageCrdtMessages((message) => {
			const wireMessage = message as DktCrdtWireMessage;
			for (const listener of [...listeners]) {
				listener(cloneWireMessage(wireMessage));
			}
		});
		if (typeof crdtRuntime.attachTransport === "function") {
			crdtRuntime.attachTransport(transport, { baseModel: context.baseModel });
		}
		return () => {
			unsubscribePage();
			transport.close?.();
		};
	},
});

const isCrdtTestHarnessEnabled = (): boolean =>
	import.meta.env.VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS === "1" ||
	import.meta.env.VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS === "true";

type ProductRoomRuntime = {
	owner: ReturnType<typeof createProductRoomTransportOwner>;
	listeners: Set<(message: DktCrdtWireMessage) => void>;
};

const cloneUnknownWireMessage = (message: unknown): DktCrdtWireMessage =>
	cloneWireMessage(message as DktCrdtWireMessage);

type MiniCutDktWorkerModelRuntimeOptions = {
	enableProductionCrdt?: boolean;
};

export const createMiniCutDktWorkerModelRuntime = (
	options: MiniCutDktWorkerModelRuntimeOptions = {},
) => {
	const enableCrdtTestHarness = isCrdtTestHarnessEnabled();
	const enableProductionCrdt = options.enableProductionCrdt ?? true;
	const productRooms = new Map<string, ProductRoomRuntime>();

	const getProductRoom = (roomId: string): ProductRoomRuntime => {
		let room = productRooms.get(roomId);
		if (room) {
			return room;
		}
		const listeners = new Set<(message: DktCrdtWireMessage) => void>();
		const owner = createProductRoomTransportOwner({
			roomId,
			onCrdtPacket(packet) {
				const wireMessage = cloneUnknownWireMessage(packet.payload);
				for (const listener of [...listeners]) {
					listener(cloneWireMessage(wireMessage));
				}
			},
		});
		room = { owner, listeners };
		productRooms.set(roomId, room);
		return room;
	};

	const createProductRoomCrdtTransport = (roomId: string): MiniCutCrdtTransport => ({
		attach(crdtRuntime, context): () => void {
			const room = getProductRoom(roomId);
			const transport: DktCrdtTransport = {
				send(message) {
					room.owner.sendCrdtPacket(cloneWireMessage(message));
				},
				subscribe(listener) {
					room.listeners.add(listener);
					return () => room.listeners.delete(listener);
				},
				close() {
					room.listeners.clear();
				},
			};
			if (typeof crdtRuntime.attachTransport === "function") {
				crdtRuntime.attachTransport(transport, { baseModel: context.baseModel });
			}
			return () => {
				transport.close?.();
			};
		},
	});

	const runtime = createMiniCutDktRuntime({
		enabled: true,
		crdt: enableCrdtTestHarness
			? {
					enabled: true,
					peerIdForSession: (sessionKey, sessionId) =>
						`minicut-browser:${sessionKey}:${sessionId}`,
					transportForSession: () => createPageBridgeCrdtTransport(),
					defaultStorageDbNameForSessionKey: (sessionKey) =>
						createMiniCutWorkspaceDbName(
							createMiniCutHarnessWorkspaceId(sessionKey),
						),
					workspaceIdForSessionKey: (sessionKey) =>
						createMiniCutHarnessWorkspaceId(sessionKey),
				}
			: enableProductionCrdt
				? {
					enabled: true,
					peerIdForSessionKey: (sessionKey) =>
						createMiniCutRoomPeerId(createMiniCutHarnessWorkspaceId(sessionKey)),
					transportForSession: (sessionKey) =>
						createProductRoomCrdtTransport(sessionKey),
					defaultStorageDbNameForSessionKey: (sessionKey) =>
						createMiniCutWorkspaceDbName(
							createMiniCutHarnessWorkspaceId(sessionKey),
						),
					workspaceIdForSessionKey: (sessionKey) =>
						createMiniCutHarnessWorkspaceId(sessionKey),
				}
				: false,
		unloadModels: enableCrdtTestHarness,
	});
	const activeSessionKeys = new Set<string>();
	const activeConnections = new Set<{ destroy(): void }>();

	const connect = (
		transport: DomSyncTransportLike<MiniCutDktTransportMessage>,
	) => {
		let sessionKey: string | null = null;
		let tabId: string | null = null;
		let tabRoomId: string | null = null;
		const sendProductRoomMessage = (message: ProductRoomProtocolMessage) => {
			transport.send({ type: DKT_MSG.PRODUCT_ROOM_MESSAGE, message });
		};
		const handleProductRoomMessage = (message: ProductRoomProtocolMessage): void => {
			switch (message.type) {
				case PRODUCT_ROOM_MSG.TAB_HELLO: {
					tabId = message.tabId;
					tabRoomId = message.roomId;
					getProductRoom(message.roomId).owner.registerTab(
						message,
						sendProductRoomMessage,
					);
					return;
				}
				case PRODUCT_ROOM_MSG.WEBRTC_STATUS: {
					getProductRoom(message.roomId).owner.handleOwnerStatus(message);
					return;
				}
				case PRODUCT_ROOM_MSG.CRDT_RECEIVE: {
					if (!tabId) {
						return;
					}
					getProductRoom(message.roomId).owner.handleCrdtReceive({
						...message,
						tabId,
					});
					return;
				}
			}
		};
		const unlisten = transport.listen((message) => {
			if (message.type === DKT_MSG.PRODUCT_ROOM_MESSAGE) {
				handleProductRoomMessage(message.message);
				return;
			}
			if (
				message.type === DKT_MSG.BOOTSTRAP &&
				typeof message.sessionKey === "string"
			) {
				sessionKey = message.sessionKey;
				activeSessionKeys.add(message.sessionKey);
			}
			if (message.type === DKT_MSG.CLOSE_SESSION && sessionKey) {
				activeSessionKeys.delete(sessionKey);
				sessionKey = null;
			}
		});
		const runtimeTransport: DomSyncTransportLike<MiniCutDktTransportMessage> = {
			send(message) {
				if (message.type === DKT_MSG.WORKSPACE_OPEN_STATE && sessionKey) {
					getProductRoom(sessionKey).owner.setWorkspaceOpenState(message.state);
				}
				transport.send(message);
			},
			listen: transport.listen.bind(transport),
			destroy: transport.destroy?.bind(transport),
			onDisconnect: transport.onDisconnect?.bind(transport),
		};
		const connection = runtime.connect(runtimeTransport);
		const trackedConnection = {
			destroy(): void {
				if (tabId && tabRoomId) {
					getProductRoom(tabRoomId).owner.unregisterTab(tabId);
				}
				if (sessionKey) {
					activeSessionKeys.delete(sessionKey);
					sessionKey = null;
				}
				unlisten();
				activeConnections.delete(trackedConnection);
				connection.destroy();
			},
		};
		activeConnections.add(trackedConnection);
		return trackedConnection;
	};

	const destroy = (): void => {
		for (const connection of [...activeConnections]) {
			connection.destroy();
		}
		activeSessionKeys.clear();
	};

	return {
		runtime,
		connect,
		destroy,
		getActiveSessionKeys: () => [...activeSessionKeys],
		getConnectionCount: () => activeConnections.size,
		getRuntimeSnapshot: () => runtime.debugDumpState(),
	};
};
