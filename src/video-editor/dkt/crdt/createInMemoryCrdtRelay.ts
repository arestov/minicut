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

const batchId = (batch: unknown): string | null => {
	if (!batch || typeof batch !== "object") {
		return null;
	}
	const value = (batch as { batch_id?: unknown; id?: unknown }).batch_id ??
		(batch as { id?: unknown }).id;
	return typeof value === "string" && value ? value : null;
};

const packetKey = (packet: MiniCutCrdtPacket): string => {
	const payloadBatchIds = packet.payload.batches
		.map(batchId)
		.filter(Boolean)
		.join("|");
	return `${packet.peerId}:${packet.profileId}:${packet.profileVersion}:payload:${payloadBatchIds || JSON.stringify(packet.payload)}`;
};

const clonePacket = (packet: MiniCutCrdtPacket): MiniCutCrdtPacket => ({
	...packet,
	payload: JSON.parse(JSON.stringify(packet.payload)) as MiniCutCrdtPacket["payload"],
});

const assertPlainObject = (value: unknown, message: string): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(message);
	}
	return value as Record<string, unknown>;
};

const assertKnownKeys = (
	value: Record<string, unknown>,
	keys: readonly string[],
	message: string,
) => {
	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) {
			throw new Error(`${message}: ${key}`);
		}
	}
};

const assertActionTraceV2 = (batch: Record<string, unknown>) => {
	const traceValue = batch.action_trace;
	if (traceValue == null) {
		return;
	}
	const trace = assertPlainObject(traceValue, "CRDT relay rejected invalid action_trace");
	assertKnownKeys(
		trace,
		["trace_version", "frames", "produced_ops", "produced_creates"],
		"CRDT relay rejected legacy action_trace field",
	);
	if (trace.trace_version !== 2) {
		throw new Error("CRDT relay rejected non-v2 action_trace");
	}
	const frames = Array.isArray(trace.frames) ? trace.frames : null;
	const producedOps = Array.isArray(trace.produced_ops) ? trace.produced_ops : null;
	const producedCreates = Array.isArray(trace.produced_creates)
		? trace.produced_creates
		: null;
	if (!frames || !producedOps || !producedCreates) {
		throw new Error("CRDT relay rejected invalid action_trace collections");
	}
	const frameIds = new Set<number>();
	const parentEdges = new Map<number, number>();
	for (const frameValue of frames) {
		const frame = assertPlainObject(frameValue, "CRDT relay rejected invalid action_trace frame");
		assertKnownKeys(
			frame,
			[
				"frame_id",
				"parent_frame_id",
				"scheduled_by_frame_id",
				"target_node_id",
				"target_model_name",
			],
			"CRDT relay rejected legacy action_trace frame field",
		);
		if (typeof frame.frame_id !== "number") {
			throw new Error("CRDT relay rejected action_trace frame without frame_id");
		}
		if (frameIds.has(frame.frame_id)) {
			throw new Error("CRDT relay rejected duplicate action_trace frame_id");
		}
		frameIds.add(frame.frame_id);
		for (const key of ["parent_frame_id", "scheduled_by_frame_id"] as const) {
			const ref = frame[key];
			if (ref != null && typeof ref !== "number") {
				throw new Error("CRDT relay rejected invalid action_trace frame reference");
			}
		}
		if (typeof frame.parent_frame_id === "number") {
			parentEdges.set(frame.frame_id, frame.parent_frame_id);
		}
	}
	for (const [frameId, parentId] of parentEdges) {
		if (!frameIds.has(parentId)) {
			throw new Error("CRDT relay rejected unknown action_trace parent frame");
		}
		const seen = new Set<number>([frameId]);
		let cursor: number | undefined = parentId;
		while (cursor != null) {
			if (seen.has(cursor)) {
				throw new Error("CRDT relay rejected cyclic action_trace frame tree");
			}
			seen.add(cursor);
			cursor = parentEdges.get(cursor);
		}
	}
	for (const frameValue of frames) {
		const frame = frameValue as Record<string, unknown>;
		const scheduledBy = frame.scheduled_by_frame_id;
		if (typeof scheduledBy === "number" && !frameIds.has(scheduledBy)) {
			throw new Error("CRDT relay rejected unknown action_trace scheduler frame");
		}
	}
	const opIds = new Set(
		(Array.isArray(batch.ops) ? batch.ops : [])
			.map((op) => (op && typeof op === "object" ? (op as { op_id?: unknown }).op_id : null))
			.filter((opId): opId is string => typeof opId === "string" && opId.length > 0),
	);
	const createdNodeIds = new Set(
		(Array.isArray(batch.created_models) ? batch.created_models : [])
			.map((record) =>
				record && typeof record === "object"
					? (record as { node_id?: unknown }).node_id
					: null,
			)
			.filter((nodeId): nodeId is string => typeof nodeId === "string" && nodeId.length > 0),
	);
	for (const itemValue of producedOps) {
		const item = assertPlainObject(itemValue, "CRDT relay rejected invalid produced op");
		assertKnownKeys(item, ["frame_id", "op_id"], "CRDT relay rejected legacy produced op field");
		if (typeof item.frame_id !== "number" || !frameIds.has(item.frame_id)) {
			throw new Error("CRDT relay rejected produced op with unknown frame");
		}
		if (typeof item.op_id !== "string" || !opIds.has(item.op_id)) {
			throw new Error("CRDT relay rejected produced op missing from batch");
		}
	}
	for (const itemValue of producedCreates) {
		const item = assertPlainObject(itemValue, "CRDT relay rejected invalid produced create");
		assertKnownKeys(item, ["frame_id", "node_id"], "CRDT relay rejected legacy produced create field");
		if (typeof item.frame_id !== "number" || !frameIds.has(item.frame_id)) {
			throw new Error("CRDT relay rejected produced create with unknown frame");
		}
		if (typeof item.node_id !== "string" || !createdNodeIds.has(item.node_id)) {
			throw new Error("CRDT relay rejected produced create missing from batch");
		}
	}
};

const assertPacketPayload = (packet: MiniCutCrdtPacket) => {
	for (const batchValue of packet.payload.batches) {
		assertActionTraceV2(assertPlainObject(batchValue, "CRDT relay rejected invalid batch"));
	}
};

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
				if (message.packet.payload.type !== "dkt-crdt-batches") {
					throw new Error("CRDT relay rejected non-DKT payload");
				}
				if (
					message.packet.profileId !== peer.profileId ||
					message.packet.profileVersion !== peer.profileVersion
				) {
					throw new Error("CRDT relay rejected packet profile mismatch");
				}
				assertPacketPayload(message.packet);
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
						payload: {
							type: "dkt-crdt-batches",
							protocol: "dkt-crdt-graph-v1",
							from: "relay",
							profile_id: peer.profileId,
							profile_version: peer.profileVersion,
							batches: room.log.flatMap((packet) => packet.payload.batches),
						},
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
