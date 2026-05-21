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
	getOrCreateMiniCutLocalPeerIdentity,
} from "../storage/minicutWorkspaceManifest";
import {
	createMiniCutDktRuntime,
	type MiniCutCrdtTransport,
} from "./createMiniCutDktRuntime";
import { WORKSPACE_OPEN_STATUS } from "./workspaceOpenState";
import { describeP2PPacket, traceP2P } from "../../p2p/p2pDebugTrace";

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
	pendingIncomingMessages: DktCrdtWireMessage[];
	canDeliverIncomingMessages: boolean;
	replayDurableLogCallbacks: Set<(targetPeerId: string) => void>;
	attachedCrdtPeers: Set<string>;
};

type CrdtRuntimeWithReadableStorage = {
	storage?: {
		getBatchesAfter?: (clock?: Record<string, number>) => Promise<unknown[]>;
	};
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
		const pendingIncomingMessages: DktCrdtWireMessage[] = [];
		let canDeliverIncomingMessages = false;
		const deliverPendingIncomingMessages = (): void => {
			if (!canDeliverIncomingMessages || listeners.size === 0) {
				return;
			}
			while (pendingIncomingMessages.length > 0) {
				const message = pendingIncomingMessages.shift();
				if (!message) {
					continue;
				}
				for (const listener of [...listeners]) {
					listener(cloneWireMessage(message));
				}
			}
		};
		const replayDurableLogCallbacks = new Set<(targetPeerId: string) => void>();
		const attachedCrdtPeers = new Set<string>();
		const owner = createProductRoomTransportOwner({
			roomId,
			onCrdtPacket(packet) {
				const wireMessage = cloneUnknownWireMessage(packet.payload);
				if (!canDeliverIncomingMessages || listeners.size === 0) {
					pendingIncomingMessages.push(wireMessage);
					traceP2P("worker-runtime:crdt-receive-buffered", {
						roomId,
						sourcePeerId: packet.sourcePeerId,
						transportGeneration: packet.transportGeneration,
						canDeliverIncomingMessages,
						listenerCount: listeners.size,
						pendingCount: pendingIncomingMessages.length,
						...describeP2PPacket(wireMessage),
					});
					return;
				}
				traceP2P("worker-runtime:crdt-receive-deliver", {
					roomId,
					sourcePeerId: packet.sourcePeerId,
					transportGeneration: packet.transportGeneration,
					listenerCount: listeners.size,
					...describeP2PPacket(wireMessage),
				});
				for (const listener of [...listeners]) {
					listener(cloneWireMessage(wireMessage));
				}
			},
			onCrdtPeerAttached(peer) {
				attachedCrdtPeers.add(peer.peerId);
				traceP2P("worker-runtime:crdt-peer-attached", {
					roomId,
					transportPeerId: peer.peerId,
					transportGeneration: peer.transportGeneration,
					replayCallbackCount: replayDurableLogCallbacks.size,
				});
				for (const replay of [...replayDurableLogCallbacks]) {
					replay(peer.peerId);
				}
			},
			onCrdtPeerDetached(peer) {
				attachedCrdtPeers.delete(peer.peerId);
			},
		});
		room = {
			owner,
			listeners,
			pendingIncomingMessages,
			get canDeliverIncomingMessages() {
				return canDeliverIncomingMessages;
			},
			set canDeliverIncomingMessages(value: boolean) {
				canDeliverIncomingMessages = value;
				deliverPendingIncomingMessages();
			},
			replayDurableLogCallbacks,
			attachedCrdtPeers,
		};
		productRooms.set(roomId, room);
		return room;
	};

	const createProductRoomCrdtTransport = (roomId: string): MiniCutCrdtTransport => ({
		attach(crdtRuntime, context): () => void {
			const room = getProductRoom(roomId);
			const replayDurableLog = (targetPeerId: string): void => {
				void Promise.resolve(
					(crdtRuntime as CrdtRuntimeWithReadableStorage).storage
						?.getBatchesAfter?.({}) ?? [],
				).then((batches) => {
					if (!Array.isArray(batches) || batches.length === 0) {
						traceP2P("worker-runtime:durable-replay-empty", {
							roomId,
							targetPeerId,
							peerId: context.peerId,
						});
						return;
					}
					traceP2P("worker-runtime:durable-replay-send", {
						roomId,
						targetPeerId,
						peerId: context.peerId,
						batchCount: batches.length,
						batchIds: batches
							.map((batch) =>
								batch && typeof batch === "object"
									? (batch as { batch_id?: unknown }).batch_id
									: null,
							)
							.filter((id): id is string => typeof id === "string"),
					});
					room.owner.sendCrdtPacket(
						cloneWireMessage({
							type: "dkt-crdt-batches",
							protocol: "dkt-crdt-graph-v1",
							from: context.peerId,
							profile_id: context.profileId,
							profile_version: context.profileVersion,
							batches,
						} as DktCrdtWireMessage),
						targetPeerId,
					);
				});
			};
			room.replayDurableLogCallbacks.add(replayDurableLog);
			const transport: DktCrdtTransport = {
				send(message) {
					traceP2P("worker-runtime:transport-send", {
						roomId,
						peerId: context.peerId,
						...describeP2PPacket(message),
					});
					room.owner.sendCrdtPacket(cloneWireMessage(message));
				},
				subscribe(listener) {
					room.listeners.add(listener);
					traceP2P("worker-runtime:transport-subscribe", {
						roomId,
						peerId: context.peerId,
						listenerCount: room.listeners.size,
						pendingCount: room.pendingIncomingMessages.length,
						canDeliverIncomingMessages: room.canDeliverIncomingMessages,
					});
					room.canDeliverIncomingMessages = room.canDeliverIncomingMessages;
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
				room.replayDurableLogCallbacks.delete(replayDurableLog);
				transport.close?.();
			};
		},
	});

	const createProductionPeerId = async (sessionKey: string): Promise<string> => {
		const workspaceId = createMiniCutHarnessWorkspaceId(sessionKey);
		const localIdentity = await getOrCreateMiniCutLocalPeerIdentity();
		return createMiniCutRoomPeerId(workspaceId, localIdentity);
	};

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
					peerIdForSessionKey: createProductionPeerId,
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
				case PRODUCT_ROOM_MSG.CRDT_PEER_ATTACHED: {
					if (!tabId) {
						return;
					}
					getProductRoom(message.roomId).owner.handleCrdtPeerAttached({
						...message,
						tabId,
					});
					return;
				}
				case PRODUCT_ROOM_MSG.CRDT_PEER_DETACHED: {
					if (!tabId) {
						return;
					}
					getProductRoom(message.roomId).owner.handleCrdtPeerDetached({
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
					const room = getProductRoom(sessionKey);
					room.owner.setWorkspaceOpenState(message.state);
					if (
						message.state.status === WORKSPACE_OPEN_STATUS.READY ||
						message.state.status === WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED
					) {
						for (const peerId of [...room.attachedCrdtPeers]) {
							for (const replay of [...room.replayDurableLogCallbacks]) {
								replay(peerId);
							}
						}
					}
				}
				if (message.type === DKT_MSG.RUNTIME_READY && sessionKey) {
					getProductRoom(sessionKey).canDeliverIncomingMessages = true;
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
