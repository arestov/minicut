import { describe, expect, it } from "vitest";
import { trackOrderConflictFixture } from "./fixtures";
import { extractTrackOrderPreview } from "./trackOrderPreview";

describe("extractTrackOrderPreview", () => {
	it("preserves current and incoming project track order from MiniCut enrichment", () => {
		expect(extractTrackOrderPreview(trackOrderConflictFixture)).toEqual({
			type: "track_order",
			currentOrder: [
				{ trackId: "track:video", name: "Video", kind: "video" },
				{ trackId: "track:audio", name: "Audio", kind: "audio" },
			],
			incomingOrder: [
				{ trackId: "track:audio", name: "Audio", kind: "audio" },
				{ trackId: "track:video", name: "Video", kind: "video" },
			],
			movedTrackIds: ["track:audio", "track:video"],
		});
	});

	it("rejects order details outside MiniCut enrichment", () => {
		expect(() =>
			extractTrackOrderPreview({
				...trackOrderConflictFixture,
				details: {
					current: [{ id: "track:a", name: "A", kind: "audio" }],
					incoming: [{ id: "track:a", name: "A", kind: "audio" }],
				},
			}),
		).toThrow("Track order conflict requires MiniCut preview details");
	});

	it("rejects bare kernel move-vs-move payloads without domain order enrichment", () => {
		expect(() =>
			extractTrackOrderPreview({
				...trackOrderConflictFixture,
				details: null,
			}),
		).toThrow("Track order conflict requires MiniCut preview details");
	});

	it("throws when typed sequence information is missing", () => {
		expect(() =>
			extractTrackOrderPreview({
				...trackOrderConflictFixture,
				payload: { currentOrder: ["track:a"] },
				details: null,
			}),
		).toThrow("Track order conflict requires typed tracks sequence payload");
	});
});
