import type { FrameMeta, ProducedPreviewFrame } from "./previewTypes";

/**
 * Bounded pool of equally sized pixel buffers. `capacity` caps the number of
 * buffers that exist at all, so memory is bounded no matter how slow the
 * consumer is: when exhausted `acquire` returns null and the producer drops.
 */
export interface FramePool {
	readonly byteLength: number;
	readonly capacity: number;
	/** Buffers allocated so far (never above `capacity`). */
	readonly allocated: number;
	/** Buffers currently handed out. */
	readonly outstanding: number;
	acquire(): Uint8Array | null;
	/** Idempotent; unknown buffers are ignored. */
	release(buffer: Uint8Array): void;
}

export const createFramePool = (options: {
	byteLength: number;
	capacity: number;
}): FramePool => {
	const { byteLength, capacity } = options;
	if (!Number.isInteger(byteLength) || byteLength <= 0) {
		throw new RangeError(`Invalid frame byteLength: ${byteLength}`);
	}
	if (!Number.isInteger(capacity) || capacity <= 0) {
		throw new RangeError(`Invalid pool capacity: ${capacity}`);
	}
	const free: Uint8Array[] = [];
	const out = new Set<Uint8Array>();
	let allocated = 0;
	return {
		byteLength,
		capacity,
		get allocated() {
			return allocated;
		},
		get outstanding() {
			return out.size;
		},
		acquire() {
			let buffer = free.pop();
			if (!buffer) {
				if (allocated >= capacity) return null;
				buffer = new Uint8Array(byteLength);
				allocated += 1;
			}
			out.add(buffer);
			return buffer;
		},
		release(buffer) {
			if (!out.delete(buffer)) return;
			free.push(buffer);
		},
	};
};

/** Wraps a pool buffer as a frame whose `release()` returns it exactly once. */
export const frameFromPoolBuffer = (
	pool: FramePool,
	pixels: Uint8Array,
	meta: FrameMeta,
	onRelease?: () => void,
): ProducedPreviewFrame => {
	let released = false;
	return {
		...meta,
		pixels,
		stride: meta.width * 4,
		format: "rgba8-straight",
		release() {
			if (released) return;
			released = true;
			pool.release(pixels);
			onRelease?.();
		},
	};
};
