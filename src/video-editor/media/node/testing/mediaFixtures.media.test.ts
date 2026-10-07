import { describe, expect, it } from "vitest";
import { stat } from "node:fs/promises";
import { ensureFixture, ensureFixtures } from "./mediaFixtures";

describe("media fixtures", () => {
	it("generates every fixture as a non-empty file and reuses the cache", async () => {
		const names = [
			"video-cfr",
			"video-audio",
			"video-vfr",
			"video-offset",
			"audio-tone",
			"image-card",
		] as const;
		const first = await ensureFixtures([...names]);
		for (const name of names) {
			expect((await stat(first[name])).size).toBeGreaterThan(0);
		}
		const mtimeBefore = (await stat(first["video-cfr"])).mtimeMs;
		const again = await ensureFixture("video-cfr");
		expect(again).toBe(first["video-cfr"]);
		expect((await stat(again)).mtimeMs).toBe(mtimeBefore);
	});
});
