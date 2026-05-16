export type MiniCutCrdtPeerId = string;
export type MiniCutCrdtRoomId = string;

export type MiniCutCrdtPacket = {
	profileId: string;
	profileVersion: number;
	peerId: string;
	vectorClock?: unknown;
	ops?: unknown[];
};

export type MiniCutCrdtRelayMessage =
	| {
			type: "crdt-join";
			roomId: string;
			peerId: string;
			profileId: string;
			profileVersion: number;
			vectorClock?: unknown;
	  }
	| {
			type: "crdt-ops";
			roomId: string;
			from: string;
			packet: MiniCutCrdtPacket;
	  }
	| {
			type: "crdt-sync-request";
			roomId: string;
			from: string;
			requestId: string;
			vectorClock: unknown;
	  }
	| {
			type: "crdt-sync-response";
			roomId: string;
			to: string;
			requestId: string;
			packet: MiniCutCrdtPacket;
	  }
	| { type: "crdt-peer-left"; roomId: string; peerId: string };

export type MiniCutCrdtRelayPeer = {
	roomId: MiniCutCrdtRoomId;
	peerId: MiniCutCrdtPeerId;
	profileId: string;
	profileVersion: number;
	vectorClock?: unknown;
	onMessage: (message: MiniCutCrdtRelayMessage) => void;
};
