import { describe, expect, it } from "vitest";
import { clipTimingConflictFixture } from "./fixtures";
import { extractClipTimingPreview } from "./clipTimingPreview";

describe("extractClipTimingPreview", () => {
	it("reads full timing variants from MiniCut enrichment details", () => {
		expect(extractClipTimingPreview(clipTimingConflictFixture)).toMatchObject({
			current: { start: 0, in: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
			incoming: { start: 2, in: 1, duration: 3, fadeIn: 0, fadeOut: 0 },
		});
	});

	it("rejects legacy timing variants outside MiniCut enrichment", () => {
		const timing = {
			current: { start: 0, in: 0, duration: 4 },
			incoming: { start: 2, in: 1, duration: 3 },
		};

		expect(() =>
			extractClipTimingPreview({
				...clipTimingConflictFixture,
				payload: timing,
				details: null,
			}),
		).toThrow("Clip timing conflict requires typed timing MVR payload");
	});

	it("does not fabricate full timing from bare CRDT MVR field alternatives", () => {
		expect(() =>
			extractClipTimingPreview({
				...clipTimingConflictFixture,
				details: null,
			}),
		).toThrow("Clip timing conflict requires MiniCut preview details");
	});
});
