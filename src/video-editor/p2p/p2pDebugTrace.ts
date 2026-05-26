type TraceDetails = Record<string, unknown>;

export type P2PTraceEntry = TraceDetails & {
	at: string;
	event: string;
	seq: number;
};

type PacketWithDebugId = Record<string, unknown> & {
	debug_message_id?: unknown;
	messageId?: unknown;
};

declare global {
	var __MINICUT_P2P_TRACE__: P2PTraceEntry[] | undefined;
	var __MINICUT_P2P_TRACE_SEQ__: number | undefined;
	var __MINICUT_P2P_MESSAGE_SEQ__: number | undefined;
	var __MINICUT_P2P_TRACE_SINK__:
		| ((entry: P2PTraceEntry) => void)
		| undefined;
}

const TRACE_PREFIX = "[minicut:p2p-trace]";
const MAX_TRACE_ENTRIES = 2000;

const getTraceStore = (): P2PTraceEntry[] => {
	globalThis.__MINICUT_P2P_TRACE__ ??= [];
	return globalThis.__MINICUT_P2P_TRACE__;
};

const nextSeq = (): number => {
	globalThis.__MINICUT_P2P_TRACE_SEQ__ =
		(globalThis.__MINICUT_P2P_TRACE_SEQ__ ?? 0) + 1;
	return globalThis.__MINICUT_P2P_TRACE_SEQ__;
};

const nextMessageSeq = (): number => {
	globalThis.__MINICUT_P2P_MESSAGE_SEQ__ =
		(globalThis.__MINICUT_P2P_MESSAGE_SEQ__ ?? 0) + 1;
	return globalThis.__MINICUT_P2P_MESSAGE_SEQ__;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const randomPart = (): string => {
	const cryptoObject = globalThis.crypto as
		| { randomUUID?: () => string; getRandomValues?: (array: Uint32Array) => Uint32Array }
		| undefined;
	if (typeof cryptoObject?.randomUUID === "function") {
		return cryptoObject.randomUUID().slice(0, 8);
	}
	if (typeof cryptoObject?.getRandomValues === "function") {
		const data = cryptoObject.getRandomValues(new Uint32Array(1));
		return data[0].toString(36);
	}
	return Math.random().toString(36).slice(2, 10);
};

export const createP2PMessageId = (prefix = "p2p"): string =>
	`${prefix}:${Date.now().toString(36)}:${nextMessageSeq().toString(36)}:${randomPart()}`;

export const getP2PMessageId = (packet: unknown): string | null => {
	const record = asRecord(packet) as PacketWithDebugId | null;
	const value = record?.debug_message_id ?? record?.messageId;
	return typeof value === "string" && value.length > 0 ? value : null;
};

export const ensureP2PMessageId = (
	packet: unknown,
	prefix = "p2p",
): string | null => {
	const record = asRecord(packet) as PacketWithDebugId | null;
	if (!record) {
		return null;
	}
	const existing = getP2PMessageId(record);
	if (existing) {
		return existing;
	}
	const messageId = createP2PMessageId(prefix);
	record.debug_message_id = messageId;
	return messageId;
};

export const describeP2PPacket = (packet: unknown): TraceDetails => {
	const record = asRecord(packet);
	if (!record) {
		return { packetKind: typeof packet };
	}

	const batches = Array.isArray(record.batches) ? record.batches : [];
	const batchIds = batches
		.map((batch) => asRecord(batch)?.batch_id)
		.filter((id): id is string => typeof id === "string");
	const opCounts = batches.map((batch) => {
		const ops = asRecord(batch)?.ops;
		return Array.isArray(ops) ? ops.length : null;
	});

	return {
		messageId: getP2PMessageId(record),
		packetType: record.type,
		protocol: record.protocol,
		from: record.from,
		profileId: record.profile_id,
		profileVersion: record.profile_version,
		batchIds,
		opCounts,
		batchCount: batches.length,
	};
};

export const traceP2P = (event: string, details: TraceDetails = {}): void => {
	const entry: P2PTraceEntry = {
		at: new Date().toISOString(),
		seq: nextSeq(),
		event,
		...details,
	};
	const store = getTraceStore();
	store.push(entry);
	if (store.length > MAX_TRACE_ENTRIES) {
		store.splice(0, store.length - MAX_TRACE_ENTRIES);
	}
	globalThis.__MINICUT_P2P_TRACE_SINK__?.(entry);
	console.info(TRACE_PREFIX, JSON.stringify(entry));
};

export const readP2PTrace = (): P2PTraceEntry[] => getTraceStore().slice();
