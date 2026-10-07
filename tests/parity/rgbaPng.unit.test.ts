import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeRgbaPng } from "./rgbaPng";

describe("encodeRgbaPng", () => {
	it("writes a PNG whose header and pixel rows round-trip", () => {
		const pixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 1, 2, 3, 4]);
		const png = encodeRgbaPng(2, 2, pixels);

		expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
		expect(png.readUInt32BE(16)).toBe(2);
		expect(png.readUInt32BE(20)).toBe(2);
		expect([png[24], png[25]]).toEqual([8, 6]);
		const idat = png.indexOf("IDAT");
		const length = png.readUInt32BE(idat - 4);
		const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
		// Each row: filter byte 0, then width * 4 bytes.
		expect([...raw]).toEqual([0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 255, 255, 1, 2, 3, 4]);
		expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
	});

	it("rejects a buffer smaller than the bitmap", () => {
		expect(() => encodeRgbaPng(2, 2, new Uint8Array(8))).toThrow("smaller");
	});
});
