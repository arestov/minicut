import type { DktCrdtTransport, DktCrdtWireMessage } from "./testRelayContracts";

type Options = {
	channelName: string;
	peerId: string;
	profileId: string;
	profileVersion: number;
};

type Envelope = {
	roomProfileId: string;
	roomProfileVersion: number;
	from: string;
	payload: DktCrdtWireMessage;
};

type TestState = {
	peerId: string;
	channelName: string;
	partitioned: boolean;
	inboundBuffered: number;
	outboundBuffered: number;
	sent: number;
	received: number;
};

type TestControl = {
	partition: () => void;
	heal: () => void;
	flush: () => Promise<void>;
	state: () => TestState;
	deliver: (message: DktCrdtWireMessage) => void;
};

type NodeBridge = (
	message: DktCrdtWireMessage,
	meta: { channelName: string; peerId: string; profileId: string; profileVersion: number },
) => Promise<void> | void;

declare global {
	interface Window {
		__MINICUT_CRDT_TEST__?: TestControl;
		__MINICUT_CRDT_NODE_SEND__?: NodeBridge;
	}
}

const cloneWireMessage = (message: DktCrdtWireMessage): DktCrdtWireMessage =>
	JSON.parse(JSON.stringify(message)) as DktCrdtWireMessage;

export const createBroadcastChannelCrdtTransport = (
	options: Options,
): DktCrdtTransport => {
	if (
		typeof window === "undefined" &&
		typeof BroadcastChannel === "undefined"
	) {
		throw new Error("MiniCut CRDT BroadcastChannel transport is unavailable");
	}
	const listeners = new Set<(message: DktCrdtWireMessage) => void>();
	const inboundBuffer: DktCrdtWireMessage[] = [];
	const outboundBuffer: DktCrdtWireMessage[] = [];
	let partitioned = false;
	let sent = 0;
	let received = 0;
	const nodeBridge =
		typeof window !== "undefined" ? window.__MINICUT_CRDT_NODE_SEND__ : undefined;
	const channel =
		nodeBridge || typeof BroadcastChannel === "undefined"
			? null
			: new BroadcastChannel(options.channelName);

	const deliver = (message: DktCrdtWireMessage) => {
		if (partitioned) {
			inboundBuffer.push(cloneWireMessage(message));
			return;
		}
		received += 1;
		for (const listener of [...listeners]) {
			listener(cloneWireMessage(message));
		}
	};

	const sendNow = async (message: DktCrdtWireMessage) => {
		sent += 1;
		const payload = cloneWireMessage(message);
		if (nodeBridge) {
			await nodeBridge(payload, {
				channelName: options.channelName,
				peerId: options.peerId,
				profileId: options.profileId,
				profileVersion: options.profileVersion,
			});
			return;
		}
		channel?.postMessage({
			roomProfileId: options.profileId,
			roomProfileVersion: options.profileVersion,
			from: options.peerId,
			payload,
		} satisfies Envelope);
	};

	const flush = async () => {
		if (partitioned) {
			return;
		}
		const outbound = outboundBuffer.splice(0, outboundBuffer.length);
		for (const message of outbound) {
			await sendNow(message);
		}
		const inbound = inboundBuffer.splice(0, inboundBuffer.length);
		for (const message of inbound) {
			deliver(message);
		}
	};

	const onMessage = (event: MessageEvent<Envelope>) => {
		const envelope = event.data;
		if (!envelope || typeof envelope !== "object") {
			return;
		}
		if (envelope.from === options.peerId) {
			return;
		}
		if (
			envelope.roomProfileId !== options.profileId ||
			envelope.roomProfileVersion !== options.profileVersion
		) {
			return;
		}
		const payload = envelope.payload;
		if (!payload || payload.type !== "dkt-crdt-batches") {
			return;
		}
		deliver(payload);
	};
	channel?.addEventListener("message", onMessage);

	if (typeof window !== "undefined") {
		window.__MINICUT_CRDT_TEST__ = {
			partition() {
				partitioned = true;
			},
			heal() {
				partitioned = false;
			},
			flush,
			state: () => ({
				peerId: options.peerId,
				channelName: options.channelName,
				partitioned,
				inboundBuffered: inboundBuffer.length,
				outboundBuffered: outboundBuffer.length,
				sent,
				received,
			}),
			deliver(message) {
				deliver(message);
			},
		};
	}

	return {
		send(message) {
			if (partitioned) {
				outboundBuffer.push(cloneWireMessage(message));
				return;
			}
			return sendNow(message);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		close() {
			listeners.clear();
			inboundBuffer.splice(0, inboundBuffer.length);
			outboundBuffer.splice(0, outboundBuffer.length);
			channel?.removeEventListener("message", onMessage);
			channel?.close();
			if (typeof window !== "undefined") {
				delete window.__MINICUT_CRDT_TEST__;
			}
		},
	};
};