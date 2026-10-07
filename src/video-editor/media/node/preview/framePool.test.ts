import { describe, expect, it } from "vitest";
import { createFramePool, frameFromPoolBuffer } from "./framePool";

const setup = (capacity = 4) => {
	const pool = createFramePool({ byteLength: 16, capacity });
	const make = (generation: number, sequence = 0) => {
		const buffer = pool.acquire();
		if (!buffer) throw new Error("pool exhausted");
		return frameFromPoolBuffer(pool, buffer, {
			width: 2,
			height: 2,
			generation,
			streamId: "s",
			sequence,
			ptsSeconds: sequence / 25,
		});
	};
	return { pool, make };
};

describe("framePool", () => {
	it("never allocates above capacity and reuses released buffers", () => {
		const pool = createFramePool({ byteLength: 8, capacity: 2 });
		const a = pool.acquire();
		const b = pool.acquire();
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(pool.acquire()).toBeNull();
		pool.release(a as Uint8Array);
		expect(pool.acquire()).toBe(a);
		expect(pool.allocated).toBe(2);
	});

	it("frame release is idempotent and returns the buffer once", () => {
		const { pool, make } = setup(1);
		const frame = make(1);
		expect(pool.outstanding).toBe(1);
		frame.release();
		frame.release();
		expect(pool.outstanding).toBe(0);
		expect(pool.acquire()).not.toBeNull();
	});

	it("rejects invalid sizes", () => {
		expect(() => createFramePool({ byteLength: 0, capacity: 1 })).toThrow(RangeError);
		expect(() => createFramePool({ byteLength: 1, capacity: 0 })).toThrow(RangeError);
	});
});
