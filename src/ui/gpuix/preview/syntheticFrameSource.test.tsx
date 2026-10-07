import { describe, expect, test } from "bun:test";
import {
	createSyntheticFrameSource,
	formatTimecode,
} from "./syntheticFrameSource";

const pixelAt = (
	frame: { width: number; pixels: Uint8Array },
	x: number,
	y: number,
) => Array.from(frame.pixels.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4));

describe("synthetic frame source", () => {
	test("renders a 2x bitmap of the layout box by default", () => {
		const source = createSyntheticFrameSource({ width: 160, height: 90 });
		const frame = source.frameAt(0);

		expect(frame.width).toBe(320);
		expect(frame.height).toBe(180);
		expect(frame.pixels.length).toBe(320 * 180 * 4);
	});

	test("is deterministic per time and changes between times", () => {
		const source = createSyntheticFrameSource({ width: 80, height: 45 });

		const first = Uint8Array.from(source.frameAt(1.25).pixels);
		source.frameAt(3);
		const again = Uint8Array.from(source.frameAt(1.25).pixels);
		const later = Uint8Array.from(source.frameAt(2.5).pixels);

		expect(again).toEqual(first);
		expect(later).not.toEqual(first);
	});

	test("keeps straight alpha in the translucent band", () => {
		const source = createSyntheticFrameSource({ width: 80, height: 45 });
		const frame = source.frameAt(0);

		// Band rows are 62..78% of the height; sample the middle, away from the bar.
		const x = frame.width - 3;
		const y = Math.floor(frame.height * 0.7);

		expect(pixelAt(frame, x, y)).toEqual([255, 200, 0, 96]);
		expect(pixelAt(frame, x, 0)[3]).toBe(255);
	});

	test("rejects an empty size", () => {
		expect(() => createSyntheticFrameSource({ width: 0, height: 10 })).toThrow(
			/positive/,
		);
	});

	test("formats timecodes", () => {
		expect(formatTimecode(0)).toBe("00:00.00");
		expect(formatTimecode(65.5)).toBe("01:05.50");
		expect(formatTimecode(-3)).toBe("00:00.00");
	});
});
