import { describe, expect, it } from "vitest";
import {
	reduceCreateManualTrackOrderSuggestion,
	reducePreserveCurrentTrackOrder,
	reduceResolveTrackOrderConflict,
} from "./actions";

const tracks = [
	{ _node_id: "track:video" },
	{ _node_id: "track:audio" },
];

const preview = {
	type: "track_order" as const,
	currentOrder: [
		{ trackId: "track:video", name: "Video", kind: "video" },
		{ trackId: "track:audio", name: "Audio", kind: "audio" },
	],
	incomingOrder: [
		{ trackId: "track:audio", name: "Audio", kind: "audio" },
		{ trackId: "track:video", name: "Video", kind: "video" },
	],
	movedTrackIds: ["track:audio", "track:video"],
};

describe("Project track order review actions", () => {
	it("applies incoming order and emits a CRDT resolve command", () => {
		expect(
			reduceResolveTrackOrderConflict(
				{
					conflictId: "conflict:track-order",
					reviewItemId: "review:conflict:track-order",
					selectedOrder: "incoming",
					trackIds: ["track:audio", "track:video"],
				},
				null,
				tracks,
			),
		).toEqual({
			tracks: ["track:audio", "track:video"],
			crdtResolve: {
				conflict_id: "conflict:track-order",
				decision: {
					action: "resolveTrackOrderConflict",
					review_item_id: "review:conflict:track-order",
					domain_result: {
						type: "track_order_applied",
						selectedOrder: "incoming",
						trackIds: ["track:audio", "track:video"],
					},
				},
			},
		});
	});

	it("preserves current order and emits a CRDT resolve command", () => {
		expect(
			reducePreserveCurrentTrackOrder(
				{
					conflictId: "conflict:track-order",
					reviewItemId: "review:conflict:track-order",
					trackIds: ["track:video", "track:audio"],
				},
				null,
				tracks,
			),
		).toMatchObject({
			tracks: ["track:video", "track:audio"],
			crdtResolve: {
				decision: {
					domain_result: {
						selectedOrder: "current",
					},
				},
			},
		});
	});

	it("updates manual suggestion preview without resolving the conflict", () => {
		expect(
			reduceCreateManualTrackOrderSuggestion(
				{
					preview,
					trackIds: ["track:audio", "track:video"],
				},
				null,
			),
		).toEqual({
			preview: {
				...preview,
				manualOrder: [
					{ trackId: "track:audio", name: "Audio", kind: "audio" },
					{ trackId: "track:video", name: "Video", kind: "video" },
				],
			},
		});
	});

	it("rejects duplicate track ids without a CRDT resolve command", () => {
		expect(
			reduceResolveTrackOrderConflict(
				{
					conflictId: "conflict:track-order",
					reviewItemId: "review:conflict:track-order",
					selectedOrder: "incoming",
					trackIds: ["track:audio", "track:audio"],
				},
				null,
				tracks,
			),
		).toBeNull();
	});
});
