import type { SignalMessage } from "./types";

export interface BridgeSignalingEvents {
	onMemberJoined(peerId: string, joinedAt: number): void;
	onMemberLeft(peerId: string): void;
	onSignal(msg: SignalMessage): void;
	onLeaderAssigned(leaderPeerId: string, epoch: number): void;
	onConnected(): void;
	onError(error: unknown): void;
}

export interface BridgeSignaling {
	sendSignal(msg: SignalMessage): void;
	sendBye?(): void;
	destroy(): void;
}

export type BridgeSignalingFactory = (params: {
	roomId: string;
	peerId: string;
	joinedAt: number;
	events: BridgeSignalingEvents;
}) => BridgeSignaling;

const MAX_CONNECT_RETRIES = 3;
const RETRY_BASE_MS = 250;
const HEARTBEAT_INTERVAL_MS = 15_000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;

export const createDoSignalingFactory = (
	signalUrl: string,
): BridgeSignalingFactory => {
	return ({ roomId, peerId, events }) => {
		let destroyed = false;
		const knownPeers = new Set<string>();
		let _connected = false;
		let connectedNotified = false;
		let lastLeaderEpoch = -1;
		let retryCount = 0;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

		const wsUrl = signalUrl.includes("/api/signal/")
			? signalUrl
			: `${signalUrl.replace(/\/$/, "")}/api/signal/${encodeURIComponent(roomId)}`;

		let ws: WebSocket | null = null;

		const notifyLeaderAssigned = (
			leaderPeerId: unknown,
			epoch: unknown,
		): void => {
			if (typeof leaderPeerId !== "string" || leaderPeerId.length === 0) {
				return;
			}

			const nextEpoch = Number(epoch);
			if (!Number.isFinite(nextEpoch)) {
				return;
			}

			if (nextEpoch < lastLeaderEpoch) {
				return;
			}

			lastLeaderEpoch = nextEpoch;
			events.onLeaderAssigned(leaderPeerId, nextEpoch);
		};

		const reconnect = (): void => {
			if (destroyed) {
				return;
			}

			console.warn("[minicut:signal] reconnecting WebSocket signaling", {
				roomId,
				peerId,
				retryCount,
			});
			stopHeartbeat();
			try {
				ws?.close();
			} catch {
				// noop
			}

			ws = null;
			_connected = false;
			scheduleRetry();
		};

		const scheduleRetry = (): void => {
			if (destroyed || retryCount >= MAX_CONNECT_RETRIES) {
				console.warn("[minicut:signal] WebSocket signaling exhausted retries", {
					roomId,
					peerId,
				});
				events.onError(new Error("WebSocket signaling error"));
				return;
			}

			const delay = RETRY_BASE_MS * 2 ** retryCount;
			retryCount += 1;
			retryTimer = setTimeout(connect, delay);
		};

		const stopHeartbeat = (): void => {
			if (!heartbeatTimer) {
				return;
			}

			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		};

		const startHeartbeat = (): void => {
			stopHeartbeat();
			heartbeatTimer = setInterval(() => {
				if (destroyed || !ws || ws.readyState !== WebSocket.OPEN) {
					return;
				}

				ws.send(
					JSON.stringify({
						type: "ping",
						roomId,
						peerId,
						ts: Date.now(),
					}),
				);
			}, HEARTBEAT_INTERVAL_MS);
		};

		const onMessage = (event: MessageEvent): void => {
			if (destroyed) {
				return;
			}

			let payload: unknown;
			try {
				payload = JSON.parse(String(event.data));
			} catch {
				return;
			}

			const msg = asRecord(payload);
			if (!msg) {
				return;
			}

			switch (msg.type) {
				case "room-state": {
					if (typeof msg.roomId === "string" && msg.roomId !== roomId) {
						return;
					}

					const peers = Array.isArray(msg.peers)
						? msg.peers.filter(
								(value): value is string => typeof value === "string",
							)
						: [];
					const newPeers = new Set(peers.filter((id) => id !== peerId));
					for (const knownPeer of knownPeers) {
						if (!newPeers.has(knownPeer)) {
							knownPeers.delete(knownPeer);
							events.onMemberLeft(knownPeer);
						}
					}
					for (const nextPeer of newPeers) {
						if (!knownPeers.has(nextPeer)) {
							knownPeers.add(nextPeer);
							events.onMemberJoined(nextPeer, 0);
						}
					}

					_connected = true;
					retryCount = 0;
					notifyLeaderAssigned(msg.leaderPeerId, msg.epoch);
					if (!connectedNotified) {
						connectedNotified = true;
						events.onConnected();
					}
					break;
				}

				case "leader-changed": {
					notifyLeaderAssigned(msg.leaderPeerId, msg.epoch);
					break;
				}

				case "pong":
					break;

				case "offer":
				case "answer":
				case "ice-candidate":
				case "server-leaving": {
					if (typeof msg.roomId === "string" && msg.roomId !== roomId) {
						return;
					}

					const from = String(msg.from ?? "");
					if (!from || from === peerId) {
						return;
					}

					const to = typeof msg.to === "string" ? msg.to : undefined;
					if (to && to !== peerId) {
						return;
					}

					events.onSignal({
						kind: msg.type,
						roomId,
						fromPeerId: from,
						toPeerId: to,
						ts: Number(msg.ts ?? Date.now()),
						...(msg.sdp ? { sdp: msg.sdp as RTCSessionDescriptionInit } : {}),
						...(msg.candidate
							? { candidate: msg.candidate as RTCIceCandidateInit }
							: {}),
					} as SignalMessage);
					break;
				}
			}
		};

		const onError = (): void => {
			if (destroyed) {
				return;
			}

			reconnect();
		};

		const onClose = (): void => {
			if (destroyed) {
				return;
			}

			if (!ws) {
				return;
			}

			reconnect();
		};

		const connect = (): void => {
			if (destroyed) {
				return;
			}
			ws = new WebSocket(wsUrl);
			ws.onopen = () => {
				if (destroyed || !ws) {
					return;
				}

				console.info("[minicut:signal] WebSocket signaling connected", {
					roomId,
					peerId,
					url: wsUrl,
				});
				startHeartbeat();
				ws.send(JSON.stringify({ type: "join", roomId, peerId }));
			};
			ws.onmessage = onMessage;
			ws.onerror = onError;
			ws.onclose = onClose;
		};

		connect();

		const sendToServer = (payload: Record<string, unknown>): void => {
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				return;
			}

			ws.send(JSON.stringify(payload));
		};

		return {
			sendSignal(msg: SignalMessage) {
				sendToServer({
					type: msg.kind,
					roomId,
					epoch: lastLeaderEpoch >= 0 ? lastLeaderEpoch : 0,
					from: peerId,
					to: msg.toPeerId,
					...(msg.kind === "offer" || msg.kind === "answer"
						? { sdp: msg.sdp }
						: {}),
					...(msg.kind === "ice-candidate" ? { candidate: msg.candidate } : {}),
					ts: msg.ts,
				});
			},

			sendBye() {
				sendToServer({ type: "bye", roomId, peerId });
			},

			destroy() {
				if (destroyed) {
					return;
				}

				destroyed = true;
				if (retryTimer) {
					clearTimeout(retryTimer);
					retryTimer = null;
				}
				stopHeartbeat();
				ws?.close();
				ws = null;
			},
		};
	};
};

export const createWsSignalingFactory = (
	signalUrl: string,
): BridgeSignalingFactory => {
	return ({ roomId, peerId, joinedAt, events }) => {
		let destroyed = false;
		let ws: WebSocket | null = new WebSocket(signalUrl);

		const sendSignal = (data: SignalMessage): void => {
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				return;
			}

			ws.send(JSON.stringify({ action: "signal", data }));
		};

		ws.onopen = () => {
			if (destroyed || !ws) {
				return;
			}

			ws.send(JSON.stringify({ action: "join", roomId, peerId, joinedAt }));
			events.onConnected();
		};

		ws.onmessage = (event) => {
			if (destroyed) {
				return;
			}

			let payload: unknown;
			try {
				payload = JSON.parse(String(event.data));
			} catch {
				return;
			}

			const msg = asRecord(payload);
			if (!msg || typeof msg.action !== "string") {
				return;
			}

			switch (msg.action) {
				case "members": {
					const members = Array.isArray(msg.members) ? msg.members : [];
					for (const member of members) {
						const item = asRecord(member);
						if (!item || typeof item.peerId !== "string") {
							continue;
						}

						events.onMemberJoined(item.peerId, Number(item.joinedAt ?? 0));
					}
					break;
				}

				case "member-joined": {
					events.onMemberJoined(
						String(msg.peerId ?? ""),
						Number(msg.joinedAt ?? 0),
					);
					break;
				}

				case "member-left": {
					events.onMemberLeft(String(msg.peerId ?? ""));
					break;
				}

				case "signal": {
					const signal = msg.data as SignalMessage;
					if (
						!signal ||
						signal.fromPeerId === peerId ||
						(signal.toPeerId && signal.toPeerId !== peerId)
					) {
						return;
					}

					events.onSignal(signal);
					break;
				}
			}
		};

		ws.onerror = () => {
			if (destroyed) {
				return;
			}

			events.onError(new Error("WebSocket signaling error"));
		};

		return {
			sendSignal,

			destroy() {
				if (destroyed) {
					return;
				}

				destroyed = true;
				ws?.close();
				ws = null;
			},
		};
	};
};
