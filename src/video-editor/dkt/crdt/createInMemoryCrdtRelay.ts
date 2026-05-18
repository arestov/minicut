import type {
	MiniCutCrdtPacket,
	MiniCutCrdtRelayMessage,
	MiniCutCrdtRelayPeer,
	MiniCutCrdtRoomId,
} from "./testRelayContracts";

type RelayRoom = {
	profileId: string;
	profileVersion: number;
	peers: Map<string, MiniCutCrdtRelayPeer>;
	log: MiniCutCrdtPacket[];
	seenPacketKeys: Set<string>;
};

type RelayOptions = {
	maxLogPackets?: number;
};

const DEFAULT_MAX_LOG_PACKETS = 100;

const opId = (op: unknown): string | null => {
	if (!op || typeof op !== "object") {
		return null;
	}
	const value = (op as { op_id?: unknown; id?: unknown }).op_id ??
		(op as { id?: unknown }).id;
	return typeof value === "string" && value ? value : null;
};

const batchId = (batch: unknown): string | null => {
	if (!batch || typeof batch !== "object") {
		return null;
	}
	const value = (batch as { batch_id?: unknown; id?: unknown }).batch_id ??
		(batch as { id?: unknown }).id;
	return typeof value === "string" && value ? value : null;
};

const packetKey = (packet: MiniCutCrdtPacket): string => {
	const batchIds = (packet.batches ?? []).map(batchId).filter(Boolean).join("|");
	if (batchIds) {
		return `${packet.peerId}:${packet.profileId}:${packet.profileVersion}:batches:${batchIds}`;
	}
	const opIds = (packet.ops ?? []).map(opId).filter(Boolean).join("|");
	return `${packet.peerId}:${packet.profileId}:${packet.profileVersion}:${opIds || JSON.stringify(packet.vectorClock ?? null)}`;
};

const clonePacket = (packet: MiniCutCrdtPacket): MiniCutCrdtPacket => ({
	...packet,
	batches: packet.batches?.map((batch) =>
		batch && typeof batch === "object" ? {
			...(batch as Record<string, unknown>),
			created_models: [
				...((batch as { created_models?: unknown[] }).created_models ?? []),
			],
			tombstones: [
				...((batch as { tombstones?: unknown[] }).tombstones ?? []),
			],
			ops: ((batch as { ops?: unknown[] }).ops ?? []).map((op) =>
				op && typeof op === "object" ? { ...(op as Record<string, unknown>) } : op,
			),
		} : batch,
	),
	ops: packet.ops?.map((op) =>
		op && typeof op === "object" ? { ...(op as Record<string, unknown>) } : op,
	),
});

export const createInMemoryCrdtRelay = (options: RelayOptions = {}) => {
	const rooms = new Map<MiniCutCrdtRoomId, RelayRoom>();
	const maxLogPackets = options.maxLogPackets ?? DEFAULT_MAX_LOG_PACKETS;

	const getRoom = (peer: MiniCutCrdtRelayPeer): RelayRoom => {
		const existing = rooms.get(peer.roomId);
		if (existing) {
			if (
				existing.profileId !== peer.profileId ||
				existing.profileVersion !== peer.profileVersion
			) {
				throw new Error(
					`CRDT relay profile mismatch for room ${peer.roomId}`,
				);
			}
			return existing;
		}
		const room: RelayRoom = {
			profileId: peer.profileId,
			profileVersion: peer.profileVersion,
			peers: new Map(),
			log: [],
			seenPacketKeys: new Set(),
		};
		rooms.set(peer.roomId, room);
		return room;
	};

	const assertPeer = (
		roomId: string,
		peerId: string,
	): { room: RelayRoom; peer: MiniCutCrdtRelayPeer } => {
		const room = rooms.get(roomId);
		const peer = room?.peers.get(peerId);
		if (!room || !peer) {
			throw new Error(`CRDT relay peer is not joined: ${roomId}/${peerId}`);
		}
		return { room, peer };
	};

	const rememberPacket = (room: RelayRoom, packet: MiniCutCrdtPacket) => {
		const key = packetKey(packet);
		if (room.seenPacketKeys.has(key)) {
			return false;
		}
		room.seenPacketKeys.add(key);
		room.log.push(clonePacket(packet));
		while (room.log.length > maxLogPackets) {
			room.log.shift();
		}
		return true;
	};

	const dispatch = (message: MiniCutCrdtRelayMessage) => {
		switch (message.type) {
			case "crdt-join": {
				const peer: MiniCutCrdtRelayPeer = {
					roomId: message.roomId,
					peerId: message.peerId,
					profileId: message.profileId,
					profileVersion: message.profileVersion,
					vectorClock: message.vectorClock,
					onMessage: () => {},
				};
				getRoom(peer).peers.set(peer.peerId, peer);
				return;
			}
			case "crdt-ops": {
				const { room, peer } = assertPeer(message.roomId, message.from);
				if (message.packet.peerId !== message.from) {
					throw new Error("CRDT relay rejected spoofed packet peerId");
				}
				if (
					message.packet.profileId !== peer.profileId ||
					message.packet.profileVersion !== peer.profileVersion
				) {
					throw new Error("CRDT relay rejected packet profile mismatch");
				}
				const isNew = rememberPacket(room, message.packet);
				if (!isNew) {
					return;
				}
				for (const [peerId, target] of room.peers) {
					if (peerId === message.from) {
						continue;
					}
					target.onMessage({ ...message, packet: clonePacket(message.packet) });
				}
				return;
			}
			case "crdt-sync-request": {
				const { room, peer } = assertPeer(message.roomId, message.from);
				peer.onMessage({
					type: "crdt-sync-response",
					roomId: message.roomId,
					to: message.from,
					requestId: message.requestId,
					packet: {
						profileId: peer.profileId,
						profileVersion: peer.profileVersion,
						peerId: "relay",
						vectorClock: message.vectorClock,
						batches: room.log.flatMap((packet) => packet.batches ?? []),
						ops: room.log.flatMap((packet) => packet.ops ?? []),
					},
				});
				return;
			}
			case "crdt-sync-response": {
				const { room } = assertPeer(message.roomId, message.to);
				room.peers.get(message.to)?.onMessage({
					...message,
					packet: clonePacket(message.packet),
				});
				return;
			}
			case "crdt-peer-left": {
				const room = rooms.get(message.roomId);
				room?.peers.delete(message.peerId);
				return;
			}
		}
	};

	const join = (peer: MiniCutCrdtRelayPeer) => {
		const room = getRoom(peer);
		if (room.peers.has(peer.peerId)) {
			throw new Error(`CRDT relay peer already joined: ${peer.peerId}`);
		}
		room.peers.set(peer.peerId, peer);
		return () => {
			dispatch({ type: "crdt-peer-left", roomId: peer.roomId, peerId: peer.peerId });
		};
	};

	const getRoomSnapshot = (roomId: MiniCutCrdtRoomId) => {
		const room = rooms.get(roomId);
		return {
			peers: [...(room?.peers.keys() ?? [])],
			log: room?.log.map(clonePacket) ?? [],
		};
	};

	return { dispatch, join, getRoomSnapshot };
};
