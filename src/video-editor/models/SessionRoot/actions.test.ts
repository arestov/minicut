import { describe, expect, it } from "vitest";
import { reduceSessionTickPlaybackAction } from "./actions";

describe("SessionRoot actions", () => {
	it("advances cursor for scoped playback ticks only while playing", () => {
		expect(
			reduceSessionTickPlaybackAction(
				{ deltaSeconds: 0.127 },
				{
					cursor: 1,
					isPlaying: true,
					previewBuffer: {
						frames: [],
						startCursor: 1,
						fps: 30,
						endCursor: 4,
					},
				},
			),
		).toEqual({ cursor: 1.13 });
		expect(
			reduceSessionTickPlaybackAction(
				{ deltaSeconds: 1 },
				{ cursor: 1, isPlaying: false },
			),
		).toBeNull();
	});

	it("refills preview buffer from dkt tick state near the buffer edge", () => {
		const result = reduceSessionTickPlaybackAction(
			{ deltaSeconds: 0.6 },
			{
				cursor: 1,
				isPlaying: true,
				previewBuffer: {
					frames: [],
					startCursor: 1,
					fps: 30,
					endCursor: 2,
				},
				previewStructure: { clipSources: [] },
			},
		);

		expect(result?.cursor).toBe(1.6);
		expect(result?.previewBuffer?.startCursor).toBe(1.6);
	});
});
