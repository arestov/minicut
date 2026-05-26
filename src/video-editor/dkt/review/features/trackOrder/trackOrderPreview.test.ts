import { describe, expect, it } from "vitest";
import { trackOrderConflictFixture } from "./fixtures";
import { extractTrackOrderPreview } from "./trackOrderPreview";

describe("extractTrackOrderPreview", () => {
	it("preserves current and incoming project track order", () => {
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

	it("uses details or variants when payload does not contain both orders", () => {
		expect(
			extractTrackOrderPreview({
				payload: null,
				details: {
					current: [{ id: "track:a", name: "A", kind: "audio" }],
					incoming: [{ id: "track:a", name: "A", kind: "audio" }],
				},
				variants: null,
			}).currentOrder,
		).toEqual([{ trackId: "track:a", name: "A", kind: "audio" }]);
	});

	it("throws when order information is incomplete", () => {
		expect(() =>
			extractTrackOrderPreview({
				payload: { currentOrder: ["track:a"] },
				details: null,
				variants: null,
			}),
		).toThrow("Unsupported track order conflict payload");
	});
});
