import { describe, expect, it } from "vitest";
import { dktSessionActions } from "./actions";

describe("SessionRoot actions", () => {
	it("has semantic playback actions without a frame tick action", () => {
		expect(dktSessionActions).toHaveProperty("play");
		expect(dktSessionActions).toHaveProperty("pausePlayback");
		expect(dktSessionActions).toHaveProperty("commitSeek");
		expect(dktSessionActions).toHaveProperty("completePlayback");
		expect(dktSessionActions).not.toHaveProperty("tickPlayback");
	});
});
