type TraceDetails = Record<string, unknown>;

export type P2PTraceEntry = TraceDetails & {
	at: string;
	event: string;
	seq: number;
};

declare global {
	var __MINICUT_P2P_TRACE__: P2PTraceEntry[] | undefined;
	var __MINICUT_P2P_TRACE_SEQ__: number | undefined;
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

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
	console.info(TRACE_PREFIX, JSON.stringify(entry));
};

export const readP2PTrace = (): P2PTraceEntry[] => getTraceStore().slice();
