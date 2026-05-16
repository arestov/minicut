import type { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import type {
	MiniCutCrdtPacket,
	MiniCutCrdtRelayMessage,
} from "./testRelayContracts";

type Relay = ReturnType<typeof createInMemoryCrdtRelay>;

type Options = {
	relay: Relay;
	roomId: string;
	peerId: string;
	profileId: string;
	profileVersion: number;
	onMessage?: (message: MiniCutCrdtRelayMessage) => void;
};

export const createTestWorkerCrdtTransport = (options: Options) => {
	const received: MiniCutCrdtRelayMessage[] = [];
	const stop = options.relay.join({
		roomId: options.roomId,
		peerId: options.peerId,
		profileId: options.profileId,
		profileVersion: options.profileVersion,
		onMessage(message) {
			received.push(message);
			options.onMessage?.(message);
		},
	});

	return {
		peerId: options.peerId,
		received,
		sendOps(packet: Omit<MiniCutCrdtPacket, "peerId" | "profileId" | "profileVersion">) {
			options.relay.dispatch({
				type: "crdt-ops",
				roomId: options.roomId,
				from: options.peerId,
				packet: {
					profileId: options.profileId,
					profileVersion: options.profileVersion,
					peerId: options.peerId,
					...packet,
				},
			});
		},
		requestSync(requestId: string, vectorClock: unknown = null) {
			options.relay.dispatch({
				type: "crdt-sync-request",
				roomId: options.roomId,
				from: options.peerId,
				requestId,
				vectorClock,
			});
		},
		close() {
			stop();
		},
	};
};
