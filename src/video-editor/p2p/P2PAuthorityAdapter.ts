import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../dkt/shared/messageTypes";
import {
	PRODUCT_ROOM_MSG,
	WEBRTC_OWNER_STATUS,
	type ProductRoomCrdtSend,
	type ProductRoomProtocolMessage,
} from "../worker/productRoomProtocol";
import type {
	DktSyncListener,
	EditorAuthorityClient,
} from "../worker/authorityClient";
import type { AuthorityResourceBindings } from "../worker/createAuthorityClient";
import { createFallbackAuthorityClient } from "../worker/fallbackAuthorityClient";
import type { BridgeSignalingFactory } from "./BridgeSignaling";
import {
	createPageP2PManager,
	type P2PCrdtTransportLike,
	type PageP2PManager,
	type PageP2PManagerConfig,
	type PageP2PManagerEvents,
} from "./PageP2PManager";
import { describeP2PPacket, traceP2P } from "./p2pDebugTrace";

const P2P_SHARED_WORKER_NAME_PREFIX = "minicut-video-editor-authority:p2p:";

const toWorkerScopeKey = (roomId: string): string =>
	roomId.replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 80);

export interface CreateP2PAuthorityAdapterConfig {
	roomId: string;
	signalUrl: string;
	workerUrl?: string | URL;
	rtcConfig?: RTCConfiguration;
	createSignaling?: BridgeSignalingFactory;
	connectionTimeoutMs?: number;
	requestTimeoutMs?: number;
	pendingCallTimeoutMs?: number;
	createLocalAuthority?: () => EditorAuthorityClient;
	createManager?: (
		config: PageP2PManagerConfig,
		events: PageP2PManagerEvents,
	) => PageP2PManager;
	onClientResourceTransport?: AuthorityResourceBindings["onClientResourceTransport"];
	onServerResourceTransport?: AuthorityResourceBindings["onServerResourceTransport"];
	onResourcePeerDisconnected?: AuthorityResourceBindings["onResourcePeerDisconnected"];
	onSessionLost?: (reason: string) => void;
	onError?: (error: unknown) => void;
}

export interface P2PAuthorityAdapter extends EditorAuthorityClient {
	readonly role: "server" | "client" | "undecided";
	readonly peerId: string;
}

export const createP2PAuthorityAdapter = (
	config: CreateP2PAuthorityAdapterConfig,
): P2PAuthorityAdapter => {
	const roomScopedWorkerName = `${P2P_SHARED_WORKER_NAME_PREFIX}${toWorkerScopeKey(config.roomId)}`;
	const createLocalAuthority =
		config.createLocalAuthority ??
		(() => {
			return createFallbackAuthorityClient({
				workerUrl: config.workerUrl,
				name: roomScopedWorkerName,
			});
		});
	const createManager = config.createManager ?? createPageP2PManager;

	let destroyed = false;
	let role: "server" | "client" | "undecided" = "undecided";
	let activeClient: EditorAuthorityClient | null = null;
	const crdtTransports = new Map<string, P2PCrdtTransportLike>();
	const quarantinedAuthorityTransports = new Set<{ destroy(): void }>();
	const clientChangeCallbacks = new Set<() => void>();
	const crdtTransportChangeCallbacks = new Set<() => void>();

	const dktSyncListeners = new Set<DktSyncListener>();

	const cleanupActiveClient = (): void => {
		activeClient?.destroy?.();
		activeClient = null;
	};

	const setActiveCrdtTransport = (
		remotePeerId: string,
		transport: P2PCrdtTransportLike,
	): void => {
		crdtTransports.get(remotePeerId)?.destroy();
		crdtTransports.set(remotePeerId, transport);
		for (const cb of crdtTransportChangeCallbacks) {
			cb();
		}
	};

	const activateClient = (
		nextRole: "server" | "client",
		nextClient: EditorAuthorityClient,
	): void => {
		if (destroyed) {
			nextClient.destroy?.();
			return;
		}

		cleanupActiveClient();
		role = nextRole;
		activeClient = nextClient;
		nextClient.subscribeDktSync?.((message) => {
			for (const listener of dktSyncListeners) {
				listener(message);
			}
		});
		for (const cb of clientChangeCallbacks) {
			cb();
		}
	};

	const manager = createManager(
		{
			roomId: config.roomId,
			signalUrl: config.signalUrl,
			workerUrl: config.workerUrl,
			rtcConfig: config.rtcConfig,
			createSignaling: config.createSignaling,
			sharedWorkerName: roomScopedWorkerName,
			connectionTimeoutMs: config.connectionTimeoutMs,
		},
		{
			onBecomeServer() {
				traceP2P("authority:role", {
					role: "server",
					roomId: config.roomId,
					pagePeerId: manager.peerId,
				});
				console.info("[minicut:p2p] authority role=server", {
					roomId: config.roomId,
					peerId: manager.peerId,
				});
				activateClient("server", createLocalAuthority());
			},

			onBecomeClient(transport) {
				traceP2P("authority:role", {
					role: "client",
					roomId: config.roomId,
					pagePeerId: manager.peerId,
				});
				console.info("[minicut:p2p] authority role=client", {
					roomId: config.roomId,
					peerId: manager.peerId,
				});
				quarantinedAuthorityTransports.add(transport);
				activateClient("client", createLocalAuthority());
			},

			onClientCrdtTransport(transport) {
				traceP2P("authority:crdt-transport", {
					direction: "client",
					remotePeerId: "server",
					roomId: config.roomId,
					pagePeerId: manager.peerId,
				});
				setActiveCrdtTransport("server", transport);
			},

			onServerCrdtTransport(remotePeerId, transport) {
				traceP2P("authority:crdt-transport", {
					direction: "server",
					remotePeerId,
					roomId: config.roomId,
					pagePeerId: manager.peerId,
				});
				setActiveCrdtTransport(remotePeerId, transport);
			},

			onClientResourceTransport(transport) {
				config.onClientResourceTransport?.(transport);
			},

			onServerResourceTransport(remotePeerId, transport) {
				config.onServerResourceTransport?.(remotePeerId, transport);
			},

			onResourcePeerDisconnected(remotePeerId) {
				config.onResourcePeerDisconnected?.(remotePeerId);
			},

			onSessionLost(reason) {
				console.warn(
					"[minicut:p2p] session lost; waiting for role re-assignment",
					{
						roomId: config.roomId,
						peerId: manager.peerId,
						reason,
					},
				);
				cleanupActiveClient();
				config.onSessionLost?.(reason);
			},

			onError(error) {
				console.warn("[minicut:p2p] manager error", error);
				config.onError?.(error);
			},
		},
	);

	return {
		get role() {
			return role;
		},

		get peerId() {
			return manager.peerId;
		},

		subscribeDktSync(listener) {
			dktSyncListeners.add(listener);
			return () => {
				dktSyncListeners.delete(listener);
			};
		},

		openDktTransport() {
			// Create a proxy transport that can switch its underlying transport on failover.
			// The proxy buffers messages until an activeClient is ready, then forwards them.
			// When activeClient changes (e.g. failover from client → server), the old transport
			// is destroyed and a new one opened, preserving all page-side listeners.
			// The last BOOTSTRAP message is cached so a new transport can be bootstrapped on reconnect.
			const pendingMessages: MiniCutDktTransportMessage[] = [];
			const transportListeners = new Set<
				(message: MiniCutDktTransportMessage) => void
			>();
			let realTransport: DomSyncTransportLike<MiniCutDktTransportMessage> | null =
				null;
			let realUnlisten: (() => void) | null = null;
			let realTransportClient: EditorAuthorityClient | null = null;
			let lastBootstrapMessage: Extract<
				MiniCutDktTransportMessage,
				{ type: typeof DKT_MSG.BOOTSTRAP }
			> | null = null;
			let attachedRoomGeneration: number | null = null;
			let isDestroyed = false;
			const crdtUnlistens = new Map<string, () => void>();
			const announcedCrdtPeers = new Set<string>();
			const pendingCrdtSends: ProductRoomCrdtSend[] = [];

			const sendProductRoomToWorker = (message: ProductRoomProtocolMessage): void => {
				traceP2P("authority:to-worker", {
					roomId: config.roomId,
					pagePeerId: manager.peerId,
					messageType: message.type,
					...("packet" in message ? describeP2PPacket(message.packet) : {}),
					...("peerId" in message ? { transportPeerId: message.peerId } : {}),
					...("sourcePeerId" in message
						? { sourcePeerId: message.sourcePeerId }
						: {}),
					...("targetPeerId" in message
						? { targetPeerId: message.targetPeerId }
						: {}),
				});
				const wrapped: MiniCutDktTransportMessage = {
					type: DKT_MSG.PRODUCT_ROOM_MESSAGE,
					message,
				};
				if (realTransport) {
					realTransport.send(wrapped);
				} else {
					pendingMessages.push(wrapped);
				}
			};

			const attachCrdtListener = (
				remotePeerId: string,
				transport: P2PCrdtTransportLike,
			): void => {
				if (attachedRoomGeneration == null) {
					return;
				}
				if (!announcedCrdtPeers.has(remotePeerId)) {
					announcedCrdtPeers.add(remotePeerId);
					traceP2P("authority:announce-crdt-peer", {
						roomId: config.roomId,
						pagePeerId: manager.peerId,
						remotePeerId,
						transportGeneration: attachedRoomGeneration,
					});
					sendProductRoomToWorker({
						type: PRODUCT_ROOM_MSG.CRDT_PEER_ATTACHED,
						roomId: config.roomId,
						transportGeneration: attachedRoomGeneration,
						peerId: remotePeerId,
					});
				}
				if (crdtUnlistens.has(remotePeerId)) {
					return;
				}
				const unlisten = transport.listen((packet, sourcePeerId) => {
					if (attachedRoomGeneration == null) {
						return;
					}
					traceP2P("authority:crdt-dc-receive", {
						roomId: config.roomId,
						pagePeerId: manager.peerId,
						remotePeerId,
						sourcePeerId: sourcePeerId || remotePeerId,
						transportGeneration: attachedRoomGeneration,
						...describeP2PPacket(packet),
					});
					sendProductRoomToWorker({
						type: PRODUCT_ROOM_MSG.CRDT_RECEIVE,
						roomId: config.roomId,
						transportGeneration: attachedRoomGeneration,
						packet,
						sourcePeerId: sourcePeerId || remotePeerId,
					});
				});
				crdtUnlistens.set(remotePeerId, unlisten);
			};

			const attachCrdtListeners = (): void => {
				for (const [remotePeerId, transport] of crdtTransports) {
					attachCrdtListener(remotePeerId, transport);
				}
				flushPendingCrdtSends();
			};

			const detachCrdtListeners = (): void => {
				if (attachedRoomGeneration != null) {
					for (const remotePeerId of announcedCrdtPeers) {
						sendProductRoomToWorker({
							type: PRODUCT_ROOM_MSG.CRDT_PEER_DETACHED,
							roomId: config.roomId,
							transportGeneration: attachedRoomGeneration,
							peerId: remotePeerId,
						});
					}
				}
				announcedCrdtPeers.clear();
				for (const unlisten of crdtUnlistens.values()) {
					unlisten();
				}
				crdtUnlistens.clear();
			};

			const sendCrdtPacket = (message: ProductRoomCrdtSend): boolean => {
				traceP2P("authority:crdt-send-request", {
					roomId: config.roomId,
					pagePeerId: manager.peerId,
					targetPeerId: message.targetPeerId,
					transportGeneration: message.transportGeneration,
					transportCount: crdtTransports.size,
					...describeP2PPacket(message.packet),
				});
				if (message.targetPeerId) {
					const transport = crdtTransports.get(message.targetPeerId);
					if (!transport) {
						traceP2P("authority:crdt-send-missing-target", {
							roomId: config.roomId,
							pagePeerId: manager.peerId,
							targetPeerId: message.targetPeerId,
							knownPeerIds: [...crdtTransports.keys()],
							...describeP2PPacket(message.packet),
						});
						return false;
					}
					transport.send(message.packet);
					traceP2P("authority:crdt-send-targeted", {
						roomId: config.roomId,
						pagePeerId: manager.peerId,
						targetPeerId: message.targetPeerId,
						...describeP2PPacket(message.packet),
					});
					return true;
				}
				if (crdtTransports.size === 0) {
					traceP2P("authority:crdt-send-no-transports", {
						roomId: config.roomId,
						pagePeerId: manager.peerId,
						...describeP2PPacket(message.packet),
					});
					return false;
				}
				for (const [remotePeerId, transport] of crdtTransports) {
					transport.send(message.packet);
					traceP2P("authority:crdt-send-broadcast-peer", {
						roomId: config.roomId,
						pagePeerId: manager.peerId,
						remotePeerId,
						...describeP2PPacket(message.packet),
					});
				}
				return true;
			};

			const flushPendingCrdtSends = (): void => {
				if (attachedRoomGeneration == null || pendingCrdtSends.length === 0) {
					return;
				}
				for (let index = 0; index < pendingCrdtSends.length; ) {
					const pending = pendingCrdtSends[index];
					if (pending.transportGeneration !== attachedRoomGeneration) {
						pendingCrdtSends.splice(index, 1);
						continue;
					}
					if (!sendCrdtPacket(pending)) {
						index += 1;
						continue;
					}
					pendingCrdtSends.splice(index, 1);
				}
			};

			const handleProductRoomFromWorker = (message: ProductRoomProtocolMessage): boolean => {
				switch (message.type) {
					case PRODUCT_ROOM_MSG.ATTACH_WEBRTC:
						attachedRoomGeneration = message.transportGeneration;
						traceP2P("authority:attach-webrtc", {
							roomId: config.roomId,
							pagePeerId: manager.peerId,
							transportGeneration: message.transportGeneration,
							knownCrdtPeers: [...crdtTransports.keys()],
						});
						attachCrdtListeners();
						flushPendingCrdtSends();
						sendProductRoomToWorker({
							type: PRODUCT_ROOM_MSG.WEBRTC_STATUS,
							tabId: manager.peerId,
							roomId: config.roomId,
							transportGeneration: message.transportGeneration,
							status: WEBRTC_OWNER_STATUS.ATTACHED,
						});
						return true;
					case PRODUCT_ROOM_MSG.DETACH_WEBRTC:
						if (attachedRoomGeneration === message.transportGeneration) {
							attachedRoomGeneration = null;
							detachCrdtListeners();
							pendingCrdtSends.length = 0;
						}
						return true;
					case PRODUCT_ROOM_MSG.CRDT_SEND: {
						if (attachedRoomGeneration !== message.transportGeneration) {
							traceP2P("authority:crdt-send-stale-generation", {
								roomId: config.roomId,
								pagePeerId: manager.peerId,
								attachedRoomGeneration,
								messageGeneration: message.transportGeneration,
							});
							return true;
						}
						const crdtMessage = message as ProductRoomCrdtSend;
						if (!sendCrdtPacket(crdtMessage)) {
							pendingCrdtSends.push(crdtMessage);
							traceP2P("authority:crdt-send-queued", {
								roomId: config.roomId,
								pagePeerId: manager.peerId,
								pendingCount: pendingCrdtSends.length,
								targetPeerId: crdtMessage.targetPeerId,
								...describeP2PPacket(crdtMessage.packet),
							});
						}
						return true;
					}
				}
				return false;
			};

			const teardownRealTransport = (): void => {
				if (realTransport) {
					realUnlisten?.();
					realTransport.destroy();
					realTransport = null;
					realUnlisten = null;
					realTransportClient = null;
				}
			};

			const activateRealTransport = (): void => {
				if (isDestroyed) {
					return;
				}

				if (
					!activeClient ||
					typeof activeClient.openDktTransport !== "function"
				) {
					return;
				}

				// If activeClient changed (e.g. failover), tear down the old transport and reconnect.
				// Notify page transports that P2P session was lost so they reset sync state and
				// re-bootstrap against the new server authority.
				const isFailover =
					realTransportClient !== null && realTransportClient !== activeClient;
				if (isFailover) {
					teardownRealTransport();
					const sessionLostMessage: MiniCutDktTransportMessage = {
						type: DKT_MSG.P2P_SESSION_LOST,
						reason: "failover",
					};
					for (const listener of transportListeners) {
						listener(sessionLostMessage);
					}
				} else if (realTransportClient !== activeClient) {
					teardownRealTransport();
				}

				if (realTransport) {
					return;
				}

				realTransportClient = activeClient;
				realTransport = activeClient.openDktTransport();
				realUnlisten = realTransport.listen((message) => {
					if (
						message.type === DKT_MSG.PRODUCT_ROOM_MESSAGE &&
						handleProductRoomFromWorker(message.message)
					) {
						return;
					}
					for (const listener of transportListeners) {
						listener(message);
					}
				});
				sendProductRoomToWorker({
					type: PRODUCT_ROOM_MSG.TAB_HELLO,
					tabId: manager.peerId,
					roomId: config.roomId,
					canHostWebRtc: true,
				});

				// On reconnect, send the cached BOOTSTRAP first so the new authority worker
				// initialises the session before processing other messages.
				if (lastBootstrapMessage) {
					realTransport.send(lastBootstrapMessage);
				}

				// Send any pending messages
				while (pendingMessages.length > 0) {
					const message = pendingMessages.shift();
					if (message) {
						realTransport.send(message);
					}
				}
			};

			// Try to activate immediately if activeClient is already ready
			activateRealTransport();

			// Also set up a listener for when activeClient becomes available or changes
			clientChangeCallbacks.add(activateRealTransport);
			crdtTransportChangeCallbacks.add(attachCrdtListeners);
			const checkInterval = setInterval(() => {
				activateRealTransport();
			}, 100);

			return {
				send(message) {
					// Cache the most recent BOOTSTRAP so we can replay it on transport reconnect
					if (message.type === DKT_MSG.BOOTSTRAP) {
						lastBootstrapMessage = message as Extract<
							MiniCutDktTransportMessage,
							{ type: typeof DKT_MSG.BOOTSTRAP }
						>;
					}
					if (realTransport) {
						realTransport.send(message);
					} else {
						pendingMessages.push(message);
					}
				},
				listen(listener) {
					transportListeners.add(listener);
					return () => {
						transportListeners.delete(listener);
					};
				},
				destroy() {
					isDestroyed = true;
					detachCrdtListeners();
					pendingCrdtSends.length = 0;
					clearInterval(checkInterval);
					clientChangeCallbacks.delete(activateRealTransport);
					crdtTransportChangeCallbacks.delete(attachCrdtListeners);
					teardownRealTransport();
					transportListeners.clear();
					pendingMessages.length = 0;
				},
			};
		},

		destroy() {
			if (destroyed) {
				return;
			}

			destroyed = true;
			dktSyncListeners.clear();
			for (const transport of quarantinedAuthorityTransports) {
				transport.destroy();
			}
			quarantinedAuthorityTransports.clear();
			for (const transport of crdtTransports.values()) {
				transport.destroy();
			}
			crdtTransports.clear();
			cleanupActiveClient();
			manager.destroy();
		},
	};
};
