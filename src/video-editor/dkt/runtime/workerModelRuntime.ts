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
import type { WorkspaceOpenState } from "./workspaceOpenState";
import {
	describeP2PPacket,
	ensureP2PMessageId,
	traceP2P,
} from "../../p2p/p2pDebugTrace";

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
	replayRetryTimeouts: Map<string, ReturnType<typeof setTimeout>>;
};

type CrdtRuntimeWithReadableStorage = {
	storage?: {
		getBatchesAfter?: (clock?: Record<string, number>) => Promise<unknown[]>;
	};
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const nodeIdFromCreatedModel = (value: unknown): string | null => {
	if (typeof value === "string") {
		return value;
	}
	const record = asRecord(value);
	const candidate = record?.node_id ?? record?.nodeId ?? record?.id;
	return typeof candidate === "string" ? candidate : null;
};

const collectNodeRefs = (value: unknown, refs: Set<string>): void => {
	if (typeof value === "string") {
		if (value.startsWith("crdt:") || value === "ROOT") {
			refs.add(value);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectNodeRefs(item, refs);
		}
		return;
	}
	const record = asRecord(value);
	if (!record) {
		return;
	}
	for (const item of Object.values(record)) {
		collectNodeRefs(item, refs);
	}
};

export const orderCrdtReplayBatchesForDelivery = (batches: unknown[]): unknown[] => {
	const creatorByNodeId = new Map<string, number>();
	const batchDeps = batches.map(() => new Set<number>());

	batches.forEach((batch, index) => {
		const record = asRecord(batch);
		const createdModels = Array.isArray(record?.created_models)
			? record.created_models
			: [];
		for (const created of createdModels) {
			const nodeId = nodeIdFromCreatedModel(created);
			if (nodeId && !creatorByNodeId.has(nodeId)) {
				creatorByNodeId.set(nodeId, index);
			}
		}
	});

	batches.forEach((batch, index) => {
		const record = asRecord(batch);
		const refs = new Set<string>();
		const ops = Array.isArray(record?.ops) ? record.ops : [];
		for (const op of ops) {
			const opRecord = asRecord(op);
			collectNodeRefs(opRecord?.node_id, refs);
			collectNodeRefs(opRecord?.value, refs);
		}
		for (const ref of refs) {
			const creatorIndex = creatorByNodeId.get(ref);
			if (creatorIndex != null && creatorIndex !== index) {
				batchDeps[index].add(creatorIndex);
			}
		}
	});

	const ordered: unknown[] = [];
	const visiting = new Set<number>();
	const visited = new Set<number>();
	const visit = (index: number): void => {
		if (visited.has(index) || visiting.has(index)) {
			return;
		}
		visiting.add(index);
		for (const dep of batchDeps[index]) {
			visit(dep);
		}
		visiting.delete(index);
		visited.add(index);
		ordered.push(batches[index]);
	};

	for (let index = 0; index < batches.length; index += 1) {
		visit(index);
	}
	return ordered;
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
		const replayRetryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
		const replayDurableLogToPeer = (peerId: string): void => {
			for (const replay of [...replayDurableLogCallbacks]) {
				replay(peerId);
			}
		};
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
				replayDurableLogToPeer(peer.peerId);
				clearTimeout(replayRetryTimeouts.get(peer.peerId));
				const timeoutId = setTimeout(() => {
					replayRetryTimeouts.delete(peer.peerId);
					if (attachedCrdtPeers.has(peer.peerId)) {
						replayDurableLogToPeer(peer.peerId);
					}
				}, 750);
				replayRetryTimeouts.set(peer.peerId, timeoutId);
			},
			onCrdtPeerDetached(peer) {
				attachedCrdtPeers.delete(peer.peerId);
				clearTimeout(replayRetryTimeouts.get(peer.peerId));
				replayRetryTimeouts.delete(peer.peerId);
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
			replayRetryTimeouts,
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
					const orderedBatches = Array.isArray(batches)
						? orderCrdtReplayBatchesForDelivery(batches)
						: [];
					if (orderedBatches.length === 0) {
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
						batchCount: orderedBatches.length,
						batchIds: orderedBatches
							.map((batch) =>
								batch && typeof batch === "object"
									? (batch as { batch_id?: unknown }).batch_id
									: null,
							)
							.filter((id): id is string => typeof id === "string"),
					});
					const replayMessage = cloneWireMessage({
							type: "dkt-crdt-batches",
							protocol: "dkt-crdt-graph-v1",
							from: context.peerId,
							profile_id: context.profileId,
							profile_version: context.profileVersion,
							batches: orderedBatches,
						} as DktCrdtWireMessage);
					ensureP2PMessageId(replayMessage, "crdt-replay");
					room.owner.sendCrdtPacket(replayMessage, targetPeerId);
				});
			};
			room.replayDurableLogCallbacks.add(replayDurableLog);
			for (const peerId of room.attachedCrdtPeers) {
				replayDurableLog(peerId);
			}
			const transport: DktCrdtTransport = {
				send(message) {
					ensureP2PMessageId(message, "crdt-worker");
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
					const workspaceState = message.state as WorkspaceOpenState;
					const room = getProductRoom(sessionKey);
					room.owner.setWorkspaceOpenState(workspaceState);
					if (
						workspaceState.status === WORKSPACE_OPEN_STATUS.READY ||
						workspaceState.status === WORKSPACE_OPEN_STATUS.LOCAL_EMPTY_READY
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
