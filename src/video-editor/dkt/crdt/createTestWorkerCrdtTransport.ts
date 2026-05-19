import type { createInMemoryCrdtRelay } from "./createInMemoryCrdtRelay";
import { createMiniCutRoomCrdtTransport } from "./createMiniCutRoomCrdtTransport";
import type { MiniCutCrdtRelayMessage } from "./testRelayContracts";

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
	};
};
