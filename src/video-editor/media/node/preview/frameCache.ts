/**
 * Small LRU of decoded frames. The cache owns private copies of the pixels
 * (never pool buffers), so a cached frame can be served to any number of
 * consumers by copying into a pool buffer.
 */
export interface FrameCache {
	readonly capacity: number;
	readonly size: number;
	/** Presence check that does not change the recency order. */
	has(key: string): boolean;
	/** Marks the entry as most recently used. */
	get(key: string): Uint8Array | undefined;
	/** Stores a copy of `pixels`; evicts the least recently used entry. */
	set(key: string, pixels: Uint8Array): void;
	clear(): void;
}

export const createFrameCache = (options: { capacity: number }): FrameCache => {
	const { capacity } = options;
	if (!Number.isInteger(capacity) || capacity < 0) {
		throw new RangeError(`Invalid cache capacity: ${capacity}`);
	}
	// Map iteration order is insertion order: first key is the oldest.
	const entries = new Map<string, Uint8Array>();
	return {
		capacity,
		get size() {
			return entries.size;
		},
		has: (key) => entries.has(key),
		get(key) {
			const value = entries.get(key);
			if (!value) return undefined;
			entries.delete(key);
			entries.set(key, value);
			return value;
		},
		set(key, pixels) {
			if (capacity === 0) return;
			const existing = entries.get(key);
			entries.delete(key);
			if (!existing && entries.size >= capacity) {
				const oldest = entries.keys().next().value as string;
				entries.delete(oldest);
			}
			entries.set(key, pixels.slice());
		},
		clear() {
			entries.clear();
		},
	};
};
