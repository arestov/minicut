import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../dkt/shared/messageTypes";
import type { WireMessage } from "../domain/types";
import type { BridgeSignalingFactory } from "./BridgeSignaling";
import { createDoSignalingFactory } from "./BridgeSignaling";
import type { SignalMessage } from "./types";

export interface P2PTransportLike {
	send(message: WireMessage | MiniCutDktTransportMessage): void;
	listen(
		listener: (message: WireMessage | MiniCutDktTransportMessage) => void,
	): () => void;
	destroy(): void;
}

export interface P2PRawTransportLike {
	send(data: string | ArrayBuffer): void | Promise<void>;
	listen(listener: (data: string | ArrayBuffer) => void): () => void;
	destroy(): void;
}

export interface P2PCrdtTransportLike {
	send(packet: unknown): void;
	listen(listener: (packet: unknown, remotePeerId: string) => void): () => void;
	destroy(): void;
}

export interface PageP2PManagerConfig {
	roomId: string;
	signalUrl: string;
	workerUrl?: string | URL;
	rtcConfig?: RTCConfiguration;
	createSignaling?: BridgeSignalingFactory;
	dataChannelLabel?: string;
	crdtDataChannelLabel?: string;
	resourceDataChannelLabel?: string;
	sharedWorkerName?: string;
	connectionTimeoutMs?: number;
}

export interface PageP2PManagerEvents {
	onBecomeServer(): void;
	onBecomeClient(transport: P2PTransportLike): void;
	onClientResourceTransport?(transport: P2PRawTransportLike): void;
	onClientCrdtTransport?(transport: P2PCrdtTransportLike): void;
	onServerResourceTransport?(
		remotePeerId: string,
		transport: P2PRawTransportLike,
	): void;
	onServerCrdtTransport?(remotePeerId: string, transport: P2PCrdtTransportLike): void;
	onResourcePeerDisconnected?(remotePeerId: string): void;
	onSessionLost(reason: string): void;
	onError(error: unknown): void;
}

export interface PageP2PManager {
	readonly role: "server" | "client" | "undecided";
	readonly peerId: string;
	destroy(): void;
}

interface ProxyEntry {
	pc: RTCPeerConnection;
	dc: RTCDataChannel | null;
	proxyWorker: SharedWorker;
	proxyPort: MessagePort;
}

export const DEFAULT_STUN_ICE_SERVER: RTCIceServer = {
	urls: "stun:stun.l.google.com:19302",
};

export const createDefaultRtcConfig = (
	turnIceServer?: RTCIceServer | null,
): RTCConfiguration => ({
	iceServers: [
		DEFAULT_STUN_ICE_SERVER,
		...(turnIceServer ? [turnIceServer] : []),
	],
});

const DEFAULT_RTC_CONFIG: RTCConfiguration = createDefaultRtcConfig();

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

const parseWireMessage = (payload: unknown): WireMessage | null => {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	return payload as WireMessage;
};

export const createPageP2PManager = (
	config: PageP2PManagerConfig,
	events: PageP2PManagerEvents,
): PageP2PManager => {
	const peerId = crypto.randomUUID();
	const rtcConfig = config.rtcConfig ?? DEFAULT_RTC_CONFIG;
	const dataChannelLabel = config.dataChannelLabel ?? "minicut-authority";
	const crdtDataChannelLabel = config.crdtDataChannelLabel ?? "minicut-crdt";
	const resourceDataChannelLabel =
		config.resourceDataChannelLabel ?? "minicut-resource";
	const sharedWorkerName =
		config.sharedWorkerName ?? "minicut-video-editor-authority";
	const connectionTimeoutMs =
		config.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;

	let role: "server" | "client" | "undecided" = "undecided";
	let destroyed = false;
	let serverPeerId: string | null = null;
	let clientTransportReady = false;
	let sessionLostNotified = false;
	let currentLeaderEpoch = -1;
	let connectionWatchdog: ReturnType<typeof setTimeout> | null = null;

	const proxyConnections = new Map<string, ProxyEntry>();
	const peerConnections = new Map<string, RTCPeerConnection>();
	const dataChannels = new Map<string, RTCDataChannel>();
	const resourceTransports = new Map<string, P2PRawTransportLike>();
	const crdtTransports = new Map<string, P2PCrdtTransportLike>();
	const pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
	const remoteDescriptionReadyPeers = new Set<string>();

	const closePeer = (remotePeerId: string): void => {
		const pc = peerConnections.get(remotePeerId);
		if (pc) {
			pc.close();
			peerConnections.delete(remotePeerId);
		}
		dataChannels.delete(remotePeerId);
		const resourceTransport = resourceTransports.get(remotePeerId);
		if (resourceTransport) {
			resourceTransport.destroy();
			resourceTransports.delete(remotePeerId);
			events.onResourcePeerDisconnected?.(remotePeerId);
		}
		const crdtTransport = crdtTransports.get(remotePeerId);
		if (crdtTransport) {
			crdtTransport.destroy();
			crdtTransports.delete(remotePeerId);
		}
		pendingIceCandidates.delete(remotePeerId);
		remoteDescriptionReadyPeers.delete(remotePeerId);
		cleanupProxy(remotePeerId);
	};

	const clearConnectionWatchdog = (): void => {
		if (connectionWatchdog == null) {
			return;
		}

		clearTimeout(connectionWatchdog);
		connectionWatchdog = null;
	};

	const scheduleConnectionWatchdog = (
		targetPeerId: string,
		pc: RTCPeerConnection,
	): void => {
		clearConnectionWatchdog();
		connectionWatchdog = setTimeout(() => {
			connectionWatchdog = null;
			if (destroyed || role !== "client" || serverPeerId !== targetPeerId) {
				return;
			}

			try {
				pc.close();
			} catch {
				// noop
			}

			events.onError(new Error("WebRTC connection timed out"));
		}, connectionTimeoutMs);
	};

	const notifySessionLost = (reason: string): void => {
		if (destroyed || role !== "client" || sessionLostNotified) {
			return;
		}

		sessionLostNotified = true;
		clientTransportReady = false;
		clearConnectionWatchdog();
		events.onSessionLost(reason);
	};

	const createSignaling =
		config.createSignaling ?? createDoSignalingFactory(config.signalUrl);

	let signaling: ReturnType<BridgeSignalingFactory> | null = createSignaling({
		roomId: config.roomId,
		peerId,
		joinedAt: Date.now(),
		events: {
			onMemberJoined() {
				// role decision is driven by leader assignment
			},

			onMemberLeft(remotePeerId) {
				if (destroyed) {
					return;
				}

				if (role === "client" && remotePeerId === serverPeerId) {
					notifySessionLost("server-gone");
					return;
				}

				closePeer(remotePeerId);
			},

			onLeaderAssigned(leaderPeerId, epoch) {
				if (destroyed) {
					return;
				}

				if (
					!leaderPeerId ||
					!Number.isFinite(epoch) ||
					epoch < currentLeaderEpoch
				) {
					return;
				}

				currentLeaderEpoch = epoch;

				if (leaderPeerId === peerId) {
					becomeServer();
					return;
				}

				if (role !== "client" || serverPeerId !== leaderPeerId) {
					becomeClient(leaderPeerId);
				}
			},

			onSignal(msg) {
				if (destroyed) {
					return;
				}

				handleSignal(msg);
			},

			onConnected() {
				// leader assignment follows in room-state
			},

			onError(error) {
				if (destroyed) {
					return;
				}

				if (role === "undecided") {
					becomeServer();
					return;
				}

				if (role === "server" || (role === "client" && clientTransportReady)) {
					return;
				}

				events.onError(error);
			},
		},
	});

	const sendSignal = (msg: SignalMessage): void => {
		signaling?.sendSignal(msg);
	};

	const queueIceCandidate = (
		remotePeerId: string,
		candidate: RTCIceCandidateInit,
	): void => {
		const pending = pendingIceCandidates.get(remotePeerId) ?? [];
		pending.push(candidate);
		pendingIceCandidates.set(remotePeerId, pending);
	};

	const flushPendingIceCandidates = (
		remotePeerId: string,
		pc: RTCPeerConnection,
	): void => {
		const pending = pendingIceCandidates.get(remotePeerId);
		if (!pending || pending.length === 0) {
			return;
		}

		pendingIceCandidates.delete(remotePeerId);
		for (const candidate of pending) {
			void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
				events.onError(error);
			});
		}
	};

	const markRemoteDescriptionReady = (
		remotePeerId: string,
		pc: RTCPeerConnection,
	): void => {
		remoteDescriptionReadyPeers.add(remotePeerId);
		flushPendingIceCandidates(remotePeerId, pc);
	};

	const addOrQueueIceCandidate = (
		remotePeerId: string,
		candidate: RTCIceCandidateInit | undefined,
	): void => {
		if (!candidate) {
			return;
		}

		const pc = peerConnections.get(remotePeerId);
		if (!pc) {
			return;
		}

		if (!remoteDescriptionReadyPeers.has(remotePeerId)) {
			queueIceCandidate(remotePeerId, candidate);
			return;
		}

		void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
			events.onError(error);
		});
	};

	const createDcTransport = (dc: RTCDataChannel): P2PTransportLike => {
		const listeners = new Set<(message: WireMessage) => void>();
		let transportDestroyed = false;

		dc.onmessage = (event) => {
			if (transportDestroyed) {
				return;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(String(event.data));
			} catch {
				return;
			}

			const message = parseWireMessage(parsed);
			if (!message) {
				return;
			}

			for (const listener of listeners) {
				listener(message);
			}
		};

		dc.onclose = () => {
			if (transportDestroyed || destroyed) {
				return;
			}

			notifySessionLost("server-gone");
		};

		dc.onerror = () => {
			// onclose handles the lifecycle edge
		};

		return {
			send(message) {
				if (transportDestroyed || dc.readyState !== "open") {
					return;
				}

				dc.send(JSON.stringify(message));
			},

			listen(listener) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},

			destroy() {
				transportDestroyed = true;
				listeners.clear();
				dc.close();
			},
		};
	};

	const createCrdtDcTransport = (
		remotePeerId: string,
		dc: RTCDataChannel,
		onClosed?: () => void,
	): P2PCrdtTransportLike => {
		const listeners = new Set<(packet: unknown, remotePeerId: string) => void>();
		let transportDestroyed = false;

		dc.onmessage = (event) => {
			if (transportDestroyed) {
				return;
			}
			try {
				const packet = JSON.parse(String(event.data));
				for (const listener of listeners) {
					listener(packet, remotePeerId);
				}
			} catch {
				// Invalid CRDT channel frames are ignored at the transport boundary.
			}
		};

		dc.onclose = () => {
			if (transportDestroyed) {
				return;
			}
			onClosed?.();
		};

		dc.onerror = () => {
			// onclose owns lifecycle notification.
		};

		return {
			send(packet) {
				if (transportDestroyed || dc.readyState !== "open") {
					throw new Error("crdt_transport_not_ready");
				}
				dc.send(JSON.stringify(packet));
			},
			listen(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			destroy() {
				if (transportDestroyed) {
					return;
				}
				transportDestroyed = true;
				listeners.clear();
				dc.close();
			},
		};
	};

	/**
	 * Maximum payload bytes per DataChannel frame.
	 *
	 * Chrome/Edge announces `a=max-message-size:262144` (256 KB) in SDP.
	 * Firefox respects this limit and throws if we exceed it.
	 * Using 64 KB gives a comfortable safety margin.
	 */
	const MAX_DC_PAYLOAD_BYTES = 64 * 1024;
	const DC_BUFFERED_AMOUNT_HIGH_WATERMARK_BYTES = 512 * 1024;
	const DC_BUFFERED_AMOUNT_LOW_WATERMARK_BYTES = 256 * 1024;

	/**
	 * Binary frame header layout (12 bytes):
	 *   [0-1]  uint16 BE  magic "MC"
	 *   [2]    uint8      frame version
	 *   [3]    uint8      0x01 = final fragment, 0x00 = more follow
	 *   [4-7]  uint32 BE  fragment index (0-based)
	 *   [8-11] uint32 BE  total message size in bytes
	 */
	const FRAG_MAGIC = 0x4d43;
	const FRAG_VERSION = 1;
	const FRAG_HEADER_BYTES = 12;

	const waitForBufferedAmountLow = (
		dc: RTCDataChannel,
		isAborted: () => boolean,
	): Promise<void> => {
		if (
			isAborted() ||
			dc.readyState !== "open" ||
			dc.bufferedAmount <= DC_BUFFERED_AMOUNT_HIGH_WATERMARK_BYTES
		) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			const previousThreshold = dc.bufferedAmountLowThreshold;
			const previousHandler = dc.onbufferedamountlow;
			let settled = false;

			const finish = (): void => {
				if (settled) {
					return;
				}

				settled = true;
				dc.bufferedAmountLowThreshold = previousThreshold;
				dc.onbufferedamountlow = previousHandler;
				resolve();
			};

			const check = (): void => {
				if (
					isAborted() ||
					dc.readyState !== "open" ||
					dc.bufferedAmount <= DC_BUFFERED_AMOUNT_LOW_WATERMARK_BYTES
				) {
					finish();
				}
			};

			dc.bufferedAmountLowThreshold = DC_BUFFERED_AMOUNT_LOW_WATERMARK_BYTES;
			dc.onbufferedamountlow = (event) => {
				previousHandler?.call(dc, event);
				check();
			};

			queueMicrotask(check);
		});
	};

	const sendFragmentedBinary = async (
		dc: RTCDataChannel,
		data: ArrayBuffer,
		isAborted: () => boolean,
	): Promise<void> => {
		const totalSize = data.byteLength;
		let fragIndex = 0;
		let offset = 0;

		while (offset < totalSize) {
			await waitForBufferedAmountLow(dc, isAborted);
			if (isAborted() || dc.readyState !== "open") {
				return;
			}

			const payloadSize = Math.min(MAX_DC_PAYLOAD_BYTES, totalSize - offset);
			const isLast = offset + payloadSize >= totalSize;
			const frame = new ArrayBuffer(FRAG_HEADER_BYTES + payloadSize);
			const hdr = new DataView(frame);
			hdr.setUint16(0, FRAG_MAGIC, false);
			hdr.setUint8(2, FRAG_VERSION);
			hdr.setUint8(3, isLast ? 1 : 0);
			hdr.setUint32(4, fragIndex, false);
			hdr.setUint32(8, totalSize, false);
			new Uint8Array(frame, FRAG_HEADER_BYTES).set(
				new Uint8Array(data, offset, payloadSize),
			);
			dc.send(frame);
			offset += payloadSize;
			fragIndex++;
		}
	};

	const createRawDcTransport = (
		dc: RTCDataChannel,
		onClosed?: () => void,
	): P2PRawTransportLike => {
		const listeners = new Set<(data: string | ArrayBuffer) => void>();
		let transportDestroyed = false;
		let deliveryQueue = Promise.resolve();
		let sendQueue = Promise.resolve();

		// Reassembly state for fragmented binary messages.
		let fragParts: Uint8Array[] = [];
		let fragExpectedSize = 0;

		const enqueueDelivery = (deliver: () => void | Promise<void>): void => {
			deliveryQueue = deliveryQueue
				.then(async () => {
					if (transportDestroyed) {
						return;
					}

					await deliver();
				})
				.catch(() => undefined);
		};

		const notifyListeners = (payload: string | ArrayBuffer): void => {
			for (const listener of listeners) {
				listener(payload);
			}
		};

		const consumeBinaryFrame = (buffer: ArrayBuffer): ArrayBuffer | null => {
			if (buffer.byteLength < FRAG_HEADER_BYTES) {
				return buffer;
			}

			const hdr = new DataView(buffer);
			if (
				hdr.getUint16(0, false) !== FRAG_MAGIC ||
				hdr.getUint8(2) !== FRAG_VERSION
			) {
				return buffer;
			}

			const isLast = hdr.getUint8(3) === 1;
			const fragIndex = hdr.getUint32(4, false);
			const totalSize = hdr.getUint32(8, false);
			const payload = buffer.slice(FRAG_HEADER_BYTES);
			if (fragIndex !== fragParts.length || totalSize < payload.byteLength) {
				fragParts = [];
				fragExpectedSize = 0;
				return null;
			}

			fragParts.push(new Uint8Array(payload));
			fragExpectedSize = totalSize;

			if (!isLast) {
				return null;
			}

			// All fragments collected – assemble and deliver.
			const assembled = new Uint8Array(fragExpectedSize);
			let pos = 0;
			for (const part of fragParts) {
				if (pos + part.byteLength > assembled.byteLength) {
					fragParts = [];
					fragExpectedSize = 0;
					return null;
				}

				assembled.set(part, pos);
				pos += part.byteLength;
			}
			if (pos !== fragExpectedSize) {
				fragParts = [];
				fragExpectedSize = 0;
				return null;
			}

			fragParts = [];
			fragExpectedSize = 0;
			return assembled.buffer;
		};

		dc.onmessage = (event) => {
			if (transportDestroyed) {
				return;
			}

			const data = event.data;
			if (typeof data === "string") {
				enqueueDelivery(() => {
					notifyListeners(data);
				});
				return;
			}

			if (data instanceof ArrayBuffer) {
				const payload = consumeBinaryFrame(data);
				if (payload) {
					enqueueDelivery(() => {
						notifyListeners(payload);
					});
				}
				return;
			}

			if (ArrayBuffer.isView(data)) {
				const view = data as ArrayBufferView;
				const normalized = new Uint8Array(
					view.buffer,
					view.byteOffset,
					view.byteLength,
				).slice().buffer;
				const payload = consumeBinaryFrame(normalized);
				if (payload) {
					enqueueDelivery(() => {
						notifyListeners(payload);
					});
				}
				return;
			}

			if (typeof Blob !== "undefined" && data instanceof Blob) {
				enqueueDelivery(async () => {
					const normalized = await data.arrayBuffer();
					if (!transportDestroyed) {
						const payload = consumeBinaryFrame(normalized);
						if (payload) {
							notifyListeners(payload);
						}
					}
				});
			}
		};

		dc.onclose = () => {
			if (transportDestroyed) {
				return;
			}

			onClosed?.();
		};

		dc.onerror = () => {
			// onclose handles lifecycle teardown
		};

		const enqueueSend = (work: () => Promise<void>): Promise<void> => {
			sendQueue = sendQueue
				.then(async () => {
					if (transportDestroyed || dc.readyState !== "open") {
						return;
					}

					await work();
				})
				.catch(() => undefined);

			return sendQueue;
		};

		return {
			send(data) {
				if (transportDestroyed || dc.readyState !== "open") {
					return;
				}

				return enqueueSend(async () => {
					await waitForBufferedAmountLow(dc, () => transportDestroyed);
					if (transportDestroyed || dc.readyState !== "open") {
						return;
					}

					if (typeof data === "string") {
						dc.send(data);
						return;
					}

					await sendFragmentedBinary(dc, data, () => transportDestroyed);
				});
			},

			listen(listener) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},

			destroy() {
				if (transportDestroyed) {
					return;
				}

				transportDestroyed = true;
				listeners.clear();
				dc.close();
			},
		};
	};

	const cleanupProxy = (remotePeerId: string): void => {
		const entry = proxyConnections.get(remotePeerId);
		if (!entry) {
			return;
		}

		entry.proxyPort.onmessage = null;
		try {
			entry.proxyPort.postMessage({ type: DKT_MSG.CLOSE_SESSION });
		} catch {
			// noop
		}
		entry.proxyPort.close();
		entry.dc?.close();
		entry.pc.close();
		proxyConnections.delete(remotePeerId);
	};

	const setupServerProxy = (
		remotePeerId: string,
		dc: RTCDataChannel,
		pc: RTCPeerConnection,
	): void => {
		let proxyWorker: SharedWorker;
		try {
			// Keep this block intentionally verbose for Vite worker bundling stability.
			//
			// Why we do not collapse this into a single compact expression:
			// - Vite's worker transform is strict and expects static constructor shapes.
			// - If URL/options become non-static, Vite may emit/leave a `.ts` worker path.
			// - In production that `.ts` path is typically served with the wrong MIME type,
			//   and SharedWorker initialization fails in the browser.
			//
			// This branch form preserves both use-cases:
			// 1) externally provided worker URL for tests/overrides
			// 2) default worker URL that Vite can statically analyze and rewrite to JS
			proxyWorker = config.workerUrl
				? new SharedWorker(config.workerUrl, {
						type: "module",
						name: sharedWorkerName,
					})
				: new SharedWorker(
						new URL("../worker/dktSharedWorker.ts", import.meta.url),
						{
							type: "module",
							name: sharedWorkerName,
						},
					);
		} catch (error) {
			console.warn("[minicut:p2p] failed to create server proxy SharedWorker", {
				remotePeerId,
				error,
			});
			events.onError(error);
			dc.close();
			return;
		}
		const proxyPort = proxyWorker.port;
		proxyPort.start();
		// Do NOT pre-bootstrap the proxy worker here.
		// The client's own BOOTSTRAP message (with the correct sessionKey) will be the first
		// message forwarded through the DataChannel, establishing the right session.
		// A premature BOOTSTRAP would create a 'minicut-local' session and lock the sync
		// stream to the wrong session root, causing the client to receive no state updates.
		proxyWorker.onerror = (e) => {
			console.error(e.message, e);
			const error = new Error("P2P server proxy SharedWorker failed to load");
			console.warn("[minicut:p2p] server proxy SharedWorker failed", {
				remotePeerId,
			});
			events.onError(error);
			cleanupProxy(remotePeerId);
		};
		proxyPort.onmessageerror = () => {
			const error = new Error(
				"P2P server proxy SharedWorker port message error",
			);
			console.warn("[minicut:p2p] server proxy port message error", {
				remotePeerId,
			});
			events.onError(error);
			cleanupProxy(remotePeerId);
		};

		dc.onmessage = (event) => {
			if (destroyed) {
				return;
			}

			try {
				const parsed = JSON.parse(String(event.data));
				proxyPort.postMessage(parsed);
			} catch {
				// noop
			}
		};

		proxyPort.onmessage = (
			event: MessageEvent<WireMessage | MiniCutDktTransportMessage>,
		) => {
			if (dc.readyState === "open") {
				dc.send(JSON.stringify(event.data));
			}
		};

		dc.onclose = () => {
			cleanupProxy(remotePeerId);
		};

		proxyConnections.set(remotePeerId, {
			pc,
			dc,
			proxyWorker,
			proxyPort,
		});
	};

	const becomeServer = (): void => {
		if (role === "server" || destroyed) {
			return;
		}

		if (serverPeerId) {
			closePeer(serverPeerId);
		}

		clientTransportReady = false;
		sessionLostNotified = false;
		serverPeerId = null;
		role = "server";
		console.info("[minicut:p2p] page manager role=server", {
			roomId: config.roomId,
			peerId,
		});
		events.onBecomeServer();
	};

	const becomeClient = (targetPeerId: string): void => {
		if (destroyed) {
			return;
		}

		for (const remotePeerId of [...proxyConnections.keys()]) {
			cleanupProxy(remotePeerId);
		}

		for (const remotePeerId of [...peerConnections.keys()]) {
			closePeer(remotePeerId);
		}

		role = "client";
		serverPeerId = targetPeerId;
		clientTransportReady = false;
		sessionLostNotified = false;
		console.info("[minicut:p2p] page manager role=client", {
			roomId: config.roomId,
			peerId,
			serverPeerId: targetPeerId,
		});

		const pc = new RTCPeerConnection(rtcConfig);
		peerConnections.set(targetPeerId, pc);

		const dc = pc.createDataChannel(dataChannelLabel, { ordered: true });
		const resourceDc = pc.createDataChannel(resourceDataChannelLabel, {
			ordered: true,
		});
		const crdtDc = pc.createDataChannel(crdtDataChannelLabel, { ordered: true });
		dataChannels.set(targetPeerId, dc);
		scheduleConnectionWatchdog(targetPeerId, pc);

		dc.onopen = () => {
			if (destroyed) {
				return;
			}

			clearConnectionWatchdog();
			clientTransportReady = true;
			sessionLostNotified = false;
			events.onBecomeClient(createDcTransport(dc));
		};

		dc.onclose = () => {
			if (destroyed) {
				return;
			}

			notifySessionLost("server-gone");
			dataChannels.delete(targetPeerId);
		};

		resourceDc.binaryType = "arraybuffer";
		resourceDc.onopen = () => {
			if (destroyed) {
				return;
			}

			const transport = createRawDcTransport(resourceDc, () => {
				resourceTransports.delete(targetPeerId);
				events.onResourcePeerDisconnected?.(targetPeerId);
			});
			resourceTransports.set(targetPeerId, transport);
			events.onClientResourceTransport?.(transport);
		};

		crdtDc.onopen = () => {
			if (destroyed) {
				return;
			}
			const transport = createCrdtDcTransport(targetPeerId, crdtDc, () => {
				crdtTransports.delete(targetPeerId);
			});
			crdtTransports.set(targetPeerId, transport);
			events.onClientCrdtTransport?.(transport);
		};

		pc.onicecandidate = (event) => {
			if (!event.candidate || destroyed) {
				return;
			}

			sendSignal({
				kind: "ice-candidate",
				roomId: config.roomId,
				fromPeerId: peerId,
				toPeerId: targetPeerId,
				candidate: event.candidate.toJSON(),
				ts: Date.now(),
			});
		};

		pc.onconnectionstatechange = () => {
			if (pc.connectionState === "connected") {
				clearConnectionWatchdog();
				return;
			}

			if (pc.connectionState === "disconnected") {
				scheduleConnectionWatchdog(targetPeerId, pc);
				return;
			}

			if (pc.connectionState === "failed" || pc.connectionState === "closed") {
				clearConnectionWatchdog();
				if (!destroyed && serverPeerId === targetPeerId) {
					notifySessionLost("server-gone");
				}
			}
		};

		void pc
			.createOffer()
			.then((offer) => pc.setLocalDescription(offer).then(() => offer))
			.then(() => {
				sendSignal({
					kind: "offer",
					roomId: config.roomId,
					fromPeerId: peerId,
					toPeerId: targetPeerId,
					sdp: pc.localDescription?.toJSON() as RTCSessionDescriptionInit,
					ts: Date.now(),
				});
			})
			.catch((error) => {
				events.onError(error);
			});
	};

	const handleSignal = (msg: SignalMessage): void => {
		if (
			msg.fromPeerId === peerId ||
			(msg.toPeerId && msg.toPeerId !== peerId)
		) {
			return;
		}

		switch (msg.kind) {
			case "offer": {
				if (role !== "server") {
					return;
				}

				const remotePeerId = msg.fromPeerId;
				closePeer(remotePeerId);
				const pc = new RTCPeerConnection(rtcConfig);
				peerConnections.set(remotePeerId, pc);

				pc.ondatachannel = (event) => {
					if (event.channel.label === crdtDataChannelLabel) {
						const announceCrdtTransport = (): void => {
							if (destroyed) {
								return;
							}
							const transport = createCrdtDcTransport(remotePeerId, event.channel, () => {
								crdtTransports.delete(remotePeerId);
							});
							crdtTransports.set(remotePeerId, transport);
							events.onServerCrdtTransport?.(remotePeerId, transport);
						};

						if (event.channel.readyState === "open") {
							announceCrdtTransport();
						} else {
							event.channel.onopen = announceCrdtTransport;
						}
						return;
					}

					if (event.channel.label === resourceDataChannelLabel) {
						event.channel.binaryType = "arraybuffer";
						let announced = false;
						const announceResourceTransport = (): void => {
							if (destroyed || announced) {
								return;
							}

							announced = true;
							const transport = createRawDcTransport(event.channel, () => {
								resourceTransports.delete(remotePeerId);
								events.onResourcePeerDisconnected?.(remotePeerId);
							});
							resourceTransports.set(remotePeerId, transport);
							events.onServerResourceTransport?.(remotePeerId, transport);
						};

						if (event.channel.readyState === "open") {
							announceResourceTransport();
						} else {
							event.channel.onopen = announceResourceTransport;
						}
						return;
					}

					setupServerProxy(remotePeerId, event.channel, pc);
				};

				pc.onicecandidate = (event) => {
					if (!event.candidate || destroyed) {
						return;
					}

					sendSignal({
						kind: "ice-candidate",
						roomId: config.roomId,
						fromPeerId: peerId,
						toPeerId: remotePeerId,
						candidate: event.candidate.toJSON(),
						ts: Date.now(),
					});
				};

				void pc
					.setRemoteDescription(new RTCSessionDescription(msg.sdp))
					.then(() => {
						markRemoteDescriptionReady(remotePeerId, pc);
						return pc.createAnswer();
					})
					.then((answer) => pc.setLocalDescription(answer))
					.then(() => {
						sendSignal({
							kind: "answer",
							roomId: config.roomId,
							fromPeerId: peerId,
							toPeerId: remotePeerId,
							sdp: pc.localDescription?.toJSON() as RTCSessionDescriptionInit,
							ts: Date.now(),
						});
					})
					.catch((error) => {
						events.onError(error);
					});
				return;
			}

			case "answer": {
				const pc = peerConnections.get(msg.fromPeerId);
				if (!pc) {
					return;
				}

				void pc
					.setRemoteDescription(new RTCSessionDescription(msg.sdp))
					.then(() => {
						markRemoteDescriptionReady(msg.fromPeerId, pc);
					})
					.catch((error) => {
						events.onError(error);
					});
				return;
			}

			case "ice-candidate": {
				const pc = peerConnections.get(msg.fromPeerId);
				if (!pc) {
					return;
				}

				addOrQueueIceCandidate(msg.fromPeerId, msg.candidate);
				return;
			}

			case "server-leaving":
				if (role === "client" && msg.fromPeerId === serverPeerId) {
					notifySessionLost("server-gone");
				}
		}
	};

	return {
		get role() {
			return role;
		},

		get peerId() {
			return peerId;
		},

		destroy() {
			if (destroyed) {
				return;
			}

			destroyed = true;
			clearConnectionWatchdog();

			if (role === "server") {
				signaling?.sendSignal({
					kind: "server-leaving",
					roomId: config.roomId,
					fromPeerId: peerId,
					ts: Date.now(),
				});
			}

			for (const remotePeerId of proxyConnections.keys()) {
				cleanupProxy(remotePeerId);
			}

			for (const pc of peerConnections.values()) {
				pc.close();
			}
			peerConnections.clear();
			dataChannels.clear();
			for (const transport of resourceTransports.values()) {
				transport.destroy();
			}
			resourceTransports.clear();
			for (const transport of crdtTransports.values()) {
				transport.destroy();
			}
			crdtTransports.clear();
			pendingIceCandidates.clear();
			remoteDescriptionReadyPeers.clear();

			signaling?.sendBye?.();
			signaling?.destroy();
			signaling = null;
		},
	};
};
