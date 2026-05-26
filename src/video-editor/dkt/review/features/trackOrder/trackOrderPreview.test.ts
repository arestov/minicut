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

	it("derives orders from kernel move-vs-move payloads", () => {
		expect(
			extractTrackOrderPreview({
				payload: {
					current: { after_id: null, op_id: "A:2" },
					incoming: {
						item_id: "track:overlay",
						after_id: "track:video",
						op_id: "B:1",
					},
				},
				details: null,
				variants: null,
			}),
		).toEqual({
			type: "track_order",
			currentOrder: [
				{ trackId: "track:overlay", name: "track:overlay", kind: "video" },
				{ trackId: "track:video", name: "track:video", kind: "video" },
			],
			incomingOrder: [
				{ trackId: "track:video", name: "track:video", kind: "video" },
				{ trackId: "track:overlay", name: "track:overlay", kind: "video" },
			],
			movedTrackIds: ["track:video", "track:overlay"],
		});
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
