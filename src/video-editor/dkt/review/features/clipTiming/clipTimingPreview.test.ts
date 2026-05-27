import { describe, expect, it } from "vitest";
import { extractClipTimingPreview } from "./clipTimingPreview";

describe("extractClipTimingPreview", () => {
	it("reads alternatives from payload, details, or variants", () => {
		const timing = {
			current: { start: 0, in: 0, duration: 4 },
			incoming: { start: 2, in: 1, duration: 3 },
		};

		expect(extractClipTimingPreview({ payload: timing })).toMatchObject({
			current: { start: 0, in: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
			incoming: { start: 2, in: 1, duration: 3, fadeIn: 0, fadeOut: 0 },
		});
		expect(extractClipTimingPreview({ details: timing })).toMatchObject({
			current: { start: 0 },
			incoming: { start: 2 },
		});
		expect(extractClipTimingPreview({ variants: timing })).toMatchObject({
			current: { duration: 4 },
			incoming: { duration: 3 },
		});
	});

	it("throws for unsupported timing payloads", () => {
		expect(() =>
			extractClipTimingPreview({ payload: { current: { start: 0 } } }),
		).toThrow("Unsupported clip timing conflict payload");
	});

	it("reads validator invariant timing details from payload.details", () => {
		expect(
			extractClipTimingPreview({
				payload: {
					invariant: "duration_non_positive",
					code: "duration_non_positive",
					details: {
						current: { start: 0, in: 0, duration: 4 },
						incoming: { start: 0, in: 0, duration: -1 },
					},
				},
			}),
		).toMatchObject({
			current: { start: 0, in: 0, duration: 4 },
			incoming: { start: 0, in: 0, duration: -1 },
		});
	});

	it("does not fabricate full timing from bare CRDT MVR field alternatives", () => {
		expect(() =>
			extractClipTimingPreview({
				kind: "mvr_alternatives",
				node_id: "clip:1",
				field_name: "duration",
				payload: {
					alternatives: [3, 2],
				},
			}),
		).toThrow("Unsupported clip timing conflict payload");
	});
});
