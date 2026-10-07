import { describe, expect, it } from "vitest";
import { createFrameCache } from "./frameCache";

const px = (value: number) => new Uint8Array([value, value, value, 255]);

describe("frameCache", () => {
	it("evicts the least recently used entry", () => {
		const cache = createFrameCache({ capacity: 2 });
		cache.set("a", px(1));
		cache.set("b", px(2));
		expect(cache.get("a")?.[0]).toBe(1); // a is now newer than b
		cache.set("c", px(3));
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toBeDefined();
		expect(cache.get("c")).toBeDefined();
		expect(cache.size).toBe(2);
	});

	it("stores a private copy of the pixels", () => {
		const cache = createFrameCache({ capacity: 1 });
		const source = px(5);
		cache.set("a", source);
		source[0] = 99;
		expect(cache.get("a")?.[0]).toBe(5);
	});

	it("replacing a key does not evict others", () => {
		const cache = createFrameCache({ capacity: 2 });
		cache.set("a", px(1));
		cache.set("b", px(2));
		cache.set("b", px(3));
		expect(cache.size).toBe(2);
		expect(cache.get("a")?.[0]).toBe(1);
		expect(cache.get("b")?.[0]).toBe(3);
	});

	it("has does not refresh recency", () => {
		const cache = createFrameCache({ capacity: 2 });
		cache.set("a", px(1));
		cache.set("b", px(2));
		expect(cache.has("a")).toBe(true);
		cache.set("c", px(3));
		expect(cache.has("a")).toBe(false);
	});

	it("capacity 0 disables caching and clear empties it", () => {
		const off = createFrameCache({ capacity: 0 });
		off.set("a", px(1));
		expect(off.get("a")).toBeUndefined();
		const cache = createFrameCache({ capacity: 2 });
		cache.set("a", px(1));
		cache.clear();
		expect(cache.size).toBe(0);
	});
});
