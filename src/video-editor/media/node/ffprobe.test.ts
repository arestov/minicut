import { describe, expect, it } from "vitest";
import { detectVariableFrameRate, parseRate } from "./ffprobe";

describe("parseRate", () => {
	it("parses fractions and rejects zero/unknown", () => {
		expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
		expect(parseRate("25/1")).toBe(25);
		expect(parseRate("0/0")).toBeNull();
		expect(parseRate("N/A")).toBeNull();
		expect(parseRate(undefined)).toBeNull();
	});
});

describe("detectVariableFrameRate", () => {
	it("treats evenly spaced packets (with ms rounding) as constant", () => {
		const times = Array.from({ length: 30 }, (_, i) =>
			Math.round((i * 1000) / 30) / 1000,
		);
		expect(detectVariableFrameRate(times, 30, 30)).toBe(false);
	});
	it("flags irregular gaps", () => {
		expect(detectVariableFrameRate([0, 0.033, 0.066, 0.2, 0.233], 30, 30)).toBe(
			true,
		);
	});
	it("falls back to nominal vs average rate without packets", () => {
		expect(detectVariableFrameRate([], 60, 30)).toBe(true);
		expect(detectVariableFrameRate([], 30, 30)).toBe(false);
	});
});
