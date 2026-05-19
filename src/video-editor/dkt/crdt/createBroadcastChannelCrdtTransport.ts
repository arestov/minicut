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

const cloneWireMessage = (message: DktCrdtWireMessage): DktCrdtWireMessage =>
	JSON.parse(JSON.stringify(message)) as DktCrdtWireMessage;

export const createBroadcastChannelCrdtTransport = (
	options: Options,
): DktCrdtTransport => {
	if (typeof BroadcastChannel === "undefined") {
		throw new Error("MiniCut CRDT BroadcastChannel transport is unavailable");
	}
	const channel = new BroadcastChannel(options.channelName);
	const listeners = new Set<(message: DktCrdtWireMessage) => void>();
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
		for (const listener of [...listeners]) {
			listener(cloneWireMessage(payload));
		}
	};
	channel.addEventListener("message", onMessage);

	return {
		send(message) {
			channel.postMessage({
				roomProfileId: options.profileId,
				roomProfileVersion: options.profileVersion,
				from: options.peerId,
				payload: cloneWireMessage(message),
			} satisfies Envelope);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		close() {
			listeners.clear();
			channel.removeEventListener("message", onMessage);
			channel.close();
		},
	};
};