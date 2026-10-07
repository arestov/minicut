import { describe, expect, it } from "vitest";
import { dktSessionActions, getNextProjectIndex } from "./actions";

describe("SessionRoot actions", () => {
	it("has semantic playback actions without a frame tick action", () => {
		expect(dktSessionActions).toHaveProperty("play");
		expect(dktSessionActions).toHaveProperty("pausePlayback");
		expect(dktSessionActions).toHaveProperty("commitSeek");
		expect(dktSessionActions).toHaveProperty("completePlayback");
		expect(dktSessionActions).not.toHaveProperty("tickPlayback");
	});
});

describe("getNextProjectIndex", () => {
	it("starts at 1 and continues after the highest numbered title", () => {
		expect(getNextProjectIndex([])).toBe(1);
		expect(getNextProjectIndex(undefined)).toBe(1);
		expect(getNextProjectIndex(["Project 1", "Project 2"])).toBe(3);
		expect(getNextProjectIndex(["project 7", "Project 2"])).toBe(8);
	});

	it("ignores renamed and non-matching titles, reuses a deleted tail number", () => {
		expect(getNextProjectIndex(["Holiday cut", "Project 1x", null])).toBe(1);
		expect(getNextProjectIndex(["Project 1", "My film"])).toBe(2);
		// "Project 2" was deleted or renamed: the next number is derived again.
		expect(getNextProjectIndex(["Project 1"])).toBe(2);
	});
});
