import type { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import type {
	DktCrdtTransport,
	DktCrdtWireMessage,
	MiniCutCrdtRelayMessage,
} from "./testRelayContracts";

type Relay = ReturnType<typeof createInMemoryCrdtRelay>;

type Options = {
	relay: Relay;
	roomId: string;
	peerId: string;
	profileId: string;
	profileVersion: number;
	onRelayMessage?: (message: MiniCutCrdtRelayMessage) => void;
};

const cloneWireMessage = (message: DktCrdtWireMessage): DktCrdtWireMessage =>
	JSON.parse(JSON.stringify(message)) as DktCrdtWireMessage;

const assertWireMessage = (
	message: DktCrdtWireMessage,
	options: Pick<Options, "peerId" | "profileId" | "profileVersion">,
) => {
	if (message.type !== "dkt-crdt-batches") {
		throw new Error("MiniCut CRDT transport only accepts DKT batch messages");
	}
	if (message.protocol !== "dkt-crdt-graph-v1") {
		throw new Error("MiniCut CRDT transport rejected unknown DKT protocol");
	}
	if (message.from !== options.peerId) {
		throw new Error("MiniCut CRDT transport rejected spoofed sender");
	}
	if (
		message.profile_id != null &&
		message.profile_id !== options.profileId
	) {
		throw new Error("MiniCut CRDT transport rejected profile mismatch");
	}
	if (
		message.profile_version != null &&
		message.profile_version !== options.profileVersion
	) {
		throw new Error("MiniCut CRDT transport rejected profile mismatch");
	}
	if (!Array.isArray(message.batches)) {
		throw new Error("MiniCut CRDT transport requires batch messages");
	}
};

export const createMiniCutRoomCrdtTransport = (
	options: Options,
): DktCrdtTransport & {
	received: MiniCutCrdtRelayMessage[];
	requestSync: (requestId: string, vectorClock?: unknown) => void;
} => {
	const listeners = new Set<(message: DktCrdtWireMessage) => void>();
	const received: MiniCutCrdtRelayMessage[] = [];
	const stop = options.relay.join({
		roomId: options.roomId,
		peerId: options.peerId,
		profileId: options.profileId,
		profileVersion: options.profileVersion,
		onMessage(message) {
			received.push(message);
			options.onRelayMessage?.(message);
			const payload = message.packet?.payload;
			if (!payload) {
				return;
			}
			const cloned = cloneWireMessage(payload);
			for (const listener of [...listeners]) {
				listener(cloned);
			}
		},
	});

	return {
		received,
		send(message) {
			assertWireMessage(message, options);
			options.relay.dispatch({
				type: "crdt-ops",
				roomId: options.roomId,
				from: options.peerId,
				packet: {
					profileId: options.profileId,
					profileVersion: options.profileVersion,
					peerId: options.peerId,
					payload: cloneWireMessage(message),
				},
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		requestSync(requestId, vectorClock = null) {
			options.relay.dispatch({
				type: "crdt-sync-request",
				roomId: options.roomId,
				from: options.peerId,
				requestId,
				vectorClock,
			});
		},
		close() {
			listeners.clear();
			stop();
		},
	};
};