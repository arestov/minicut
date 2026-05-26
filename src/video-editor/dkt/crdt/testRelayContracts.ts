export type MiniCutCrdtPeerId = string;
export type MiniCutCrdtRoomId = string;

export type DktCrdtWireMessage = {
	type: "dkt-crdt-batches";
	protocol: "dkt-crdt-graph-v1";
	from: string;
	profile_id?: string;
	profile_version?: number;
	batches: unknown[];
	[key: string]: unknown;
};

export type MiniCutCrdtPacket = {
	profileId: string;
	profileVersion: number;
	peerId: string;
	payload: DktCrdtWireMessage;
	vectorClock?: unknown;
};

export type DktCrdtTransport = {
	send(message: DktCrdtWireMessage): void | Promise<void>;
	subscribe(listener: (message: DktCrdtWireMessage) => void): () => void;
	close?(): void | Promise<void>;
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
