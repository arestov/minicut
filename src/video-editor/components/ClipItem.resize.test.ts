import { describe, expect, it } from "vitest";
import { getClipResizeDeltaSecondsForUi } from "./ClipItem";

const clip = {
	start: 0,
	in: 0,
	duration: 1,
};

describe("ClipItem resize gesture bounds", () => {
	it("clamps end-edge drags to the minimum clip duration", () => {
		expect(getClipResizeDeltaSecondsForUi("end", -20, clip, 1)).toBe(-0.5);
	});

	it("clamps end-edge drags to the linked source duration", () => {
		expect(getClipResizeDeltaSecondsForUi("end", 20, clip, 1.2)).toBe(0.2);
	});

	it("keeps start-edge drags inside the clip edge bounds", () => {
		expect(
			getClipResizeDeltaSecondsForUi(
				"start",
				20,
				{ start: 2, in: 1, duration: 1 },
				1,
			),
		).toBe(0.5);
		expect(
			getClipResizeDeltaSecondsForUi(
				"start",
				-20,
				{ start: 2, in: 1, duration: 1 },
				1,
			),
		).toBe(-1);
	});
});
