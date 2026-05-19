import type { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import { createMiniCutRoomCrdtTransport } from "./createMiniCutRoomCrdtTransport";
import type {
	DktCrdtWireMessage,
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
	const transport = createMiniCutRoomCrdtTransport({
		relay: options.relay,
		roomId: options.roomId,
		peerId: options.peerId,
		profileId: options.profileId,
		profileVersion: options.profileVersion,
		onRelayMessage(message) {
			options.onMessage?.(message);
		},
	});

	return {
		...transport,
		peerId: options.peerId,
		sendOps(packet: Omit<MiniCutCrdtPacket, "peerId" | "profileId" | "profileVersion">) {
			if (packet.batches?.length) {
				transport.send({
					type: "dkt-crdt-batches",
					protocol: "dkt-crdt-graph-v1",
					from: options.peerId,
					profile_id: options.profileId,
					profile_version: options.profileVersion,
					batches: packet.batches,
				} as DktCrdtWireMessage);
				return;
			}
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
	};
};
