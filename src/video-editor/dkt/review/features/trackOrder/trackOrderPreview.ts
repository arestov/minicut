import type { CrdtConflictRecord } from "../../types";
import { readSequenceMoveConflict } from "../../dktConflictNormalizers";
import { readMiniCutConflictDetails } from "../../minicutConflictEnrichment";

export type TrackOrderEntry = {
	trackId: string;
	name: string;
	kind: string;
};

export type TrackOrderPreview = {
	type: "track_order";
	currentOrder: TrackOrderEntry[];
	incomingOrder: TrackOrderEntry[];
	movedTrackIds: string[];
	manualOrder?: TrackOrderEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asTrackId = (value: unknown): string | null => {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (isRecord(value)) {
		const id = value.trackId ?? value.id ?? value._node_id;
		return typeof id === "string" && id.length > 0 ? id : null;
	}
	return null;
};

const readTrackMeta = (
	value: unknown,
	fallbackId: string,
): TrackOrderEntry | null => {
	const trackId = asTrackId(value) ?? fallbackId;
	if (!trackId) {
		return null;
	}
	const source = isRecord(value) ? value : {};
	const states = isRecord(source.states) ? source.states : {};
	const name = source.name ?? states.name;
	const kind = source.kind ?? states.kind;
	return {
		trackId,
		name: typeof name === "string" && name.length > 0 ? name : trackId,
		kind: kind === "audio" ? "audio" : "video",
	};
};

const normalizeOrder = (
	order: unknown,
	trackMeta: Map<string, TrackOrderEntry>,
): TrackOrderEntry[] | null => {
	if (!Array.isArray(order) || order.length === 0) {
		return null;
	}
	const entries: TrackOrderEntry[] = [];
	const seen = new Set<string>();
	for (const rawEntry of order) {
		const trackId = asTrackId(rawEntry);
		if (!trackId || seen.has(trackId)) {
			return null;
		}
		seen.add(trackId);
		const meta = trackMeta.get(trackId) ?? readTrackMeta(rawEntry, trackId);
		if (!meta) {
			return null;
		}
		entries.push(meta);
	}
	return entries;
};

const collectTrackMeta = (
	source: unknown,
	target: Map<string, TrackOrderEntry>,
) => {
	if (!isRecord(source)) {
		return;
	}
	const candidates = [
		source.tracks,
		source.trackDetails,
		source.trackMeta,
		source.trackMetadata,
	];
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			for (const entry of candidate) {
				const meta = readTrackMeta(entry, "");
				if (meta) {
					target.set(meta.trackId, meta);
				}
			}
		}
		if (isRecord(candidate)) {
			for (const [trackId, entry] of Object.entries(candidate)) {
				const meta = readTrackMeta(entry, trackId);
				if (meta) {
					target.set(meta.trackId, meta);
				}
			}
		}
	}
};

const orderFromSource = (
	source: unknown,
	trackMeta: Map<string, TrackOrderEntry>,
): Pick<TrackOrderPreview, "currentOrder" | "incomingOrder"> | null => {
	if (!isRecord(source)) {
		return null;
	}
	if (isRecord(source.details)) {
		const nested = orderFromSource(source.details, trackMeta);
		if (nested) {
			return nested;
		}
	}
	collectTrackMeta(source, trackMeta);
	const currentRaw =
		source.currentOrder ?? source.current ?? source.local ?? source.ours;
	const incomingRaw =
		source.incomingOrder ?? source.incoming ?? source.remote ?? source.theirs;
	const currentOrder = normalizeOrder(currentRaw, trackMeta);
	const incomingOrder = normalizeOrder(incomingRaw, trackMeta);
	return currentOrder && incomingOrder ? { currentOrder, incomingOrder } : null;
};

const movedTrackIds = (
	currentOrder: TrackOrderEntry[],
	incomingOrder: TrackOrderEntry[],
): string[] => {
	const currentIndexes = new Map(
		currentOrder.map((entry, index) => [entry.trackId, index]),
	);
	return incomingOrder
		.filter((entry, index) => currentIndexes.get(entry.trackId) !== index)
		.map((entry) => entry.trackId);
};

export const extractTrackOrderPreview = (
	conflict: Pick<
		CrdtConflictRecord,
		"kind" | "payload" | "details" | "variants"
	>,
): TrackOrderPreview => {
	const trackMeta = new Map<string, TrackOrderEntry>();
	const minicutTrackOrder = readMiniCutConflictDetails(conflict).trackOrder;
	const sequence = readSequenceMoveConflict(conflict);
	if (!sequence || sequence.relationName !== "tracks") {
		throw new Error("Track order conflict requires typed tracks sequence payload");
	}
	collectTrackMeta(minicutTrackOrder, trackMeta);
	const orders = orderFromSource(minicutTrackOrder, trackMeta);
	if (!orders) {
		throw new Error("Track order conflict requires MiniCut preview details");
	}
	return {
		type: "track_order",
		...orders,
		movedTrackIds: movedTrackIds(orders.currentOrder, orders.incomingOrder),
	};
};
