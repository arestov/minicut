import type { CrdtConflictRecord } from "../../types";

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

const asMoveOp = (value: unknown): { itemId: string | null; afterId: string | null } | null => {
	if (!isRecord(value)) {
		return null;
	}
	const itemId = asTrackId(value.item_id ?? value.itemId);
	const afterId = asTrackId(value.after_id ?? value.afterId);
	return { itemId, afterId };
};

const entryForId = (
	trackId: string,
	trackMeta: Map<string, TrackOrderEntry>,
): TrackOrderEntry =>
	trackMeta.get(trackId) ?? { trackId, name: trackId, kind: "video" };

const orderFromMove = (
	itemId: string,
	afterId: string | null,
	otherAfterId: string | null,
	trackMeta: Map<string, TrackOrderEntry>,
): TrackOrderEntry[] => {
	const ids = [otherAfterId, afterId, itemId].filter(
		(id): id is string => typeof id === "string" && id.length > 0,
	);
	const base = Array.from(new Set(ids)).filter((id) => id !== itemId);
	const next = [...base];
	if (afterId === null) {
		next.unshift(itemId);
	} else {
		const anchorIndex = next.indexOf(afterId);
		next.splice(anchorIndex >= 0 ? anchorIndex + 1 : next.length, 0, itemId);
	}
	return next.map((trackId) => entryForId(trackId, trackMeta));
};

const orderFromKernelMovePayload = (
	source: unknown,
	trackMeta: Map<string, TrackOrderEntry>,
): Pick<TrackOrderPreview, "currentOrder" | "incomingOrder"> | null => {
	if (!isRecord(source)) {
		return null;
	}
	const current = asMoveOp(source.current);
	const incoming = asMoveOp(source.incoming);
	const itemId = incoming?.itemId ?? current?.itemId;
	if (!current || !incoming || !itemId) {
		return null;
	}
	return {
		currentOrder: orderFromMove(itemId, current.afterId, incoming.afterId, trackMeta),
		incomingOrder: orderFromMove(itemId, incoming.afterId, current.afterId, trackMeta),
	};
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
	conflict: Pick<CrdtConflictRecord, "payload" | "details" | "variants">,
): TrackOrderPreview => {
	const trackMeta = new Map<string, TrackOrderEntry>();
	collectTrackMeta(conflict.payload, trackMeta);
	collectTrackMeta(conflict.details, trackMeta);
	collectTrackMeta(conflict.variants, trackMeta);
	const orders =
		orderFromSource(conflict.payload, trackMeta) ??
		orderFromSource(conflict.details, trackMeta) ??
		orderFromSource(conflict.variants, trackMeta) ??
		orderFromKernelMovePayload(conflict.payload, trackMeta);
	if (!orders) {
		throw new Error("Unsupported track order conflict payload");
	}
	return {
		type: "track_order",
		...orders,
		movedTrackIds: movedTrackIds(orders.currentOrder, orders.incomingOrder),
	};
};
