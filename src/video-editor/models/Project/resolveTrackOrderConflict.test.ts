import { describe, expect, it } from "vitest";
import {
	reduceCreateManualTrackOrderSuggestion,
	reduceMoveTrackWithinProject,
	reducePreserveCurrentTrackOrder,
	reduceResolveTrackOrderConflict,
} from "./actions";

const tracks = [
	{ _node_id: "track:video" },
	{ _node_id: "track:audio" },
];

const tracksWithOverlay = [
	{ _node_id: "track:video" },
	{ _node_id: "track:audio" },
	{ _node_id: "track:overlay" },
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
	it("moves a track through the user reorder relation method", () => {
		expect(
			reduceMoveTrackWithinProject(
				{
					trackId: "track:audio",
					afterTrackId: null,
				},
				null,
				tracks,
			),
		).toEqual({
			tracks: [0, tracks[1]],
		});
	});

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
			tracks: {
				id: null,
				value: [tracks[1], tracks[0]],
			},
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

	it("expands sparse natural order payloads with remaining project tracks", () => {
		expect(
			reduceResolveTrackOrderConflict(
				{
					conflictId: "conflict:track-order",
					reviewItemId: "review:conflict:track-order",
					selectedOrder: "incoming",
					trackIds: ["track:audio", "track:video"],
				},
				null,
				tracksWithOverlay,
			),
		).toEqual({
			tracks: {
				id: null,
				value: [tracksWithOverlay[1], tracksWithOverlay[0], tracksWithOverlay[2]],
			},
			crdtResolve: {
				conflict_id: "conflict:track-order",
				decision: {
					action: "resolveTrackOrderConflict",
					review_item_id: "review:conflict:track-order",
					domain_result: {
						type: "track_order_applied",
						selectedOrder: "incoming",
						trackIds: ["track:audio", "track:video", "track:overlay"],
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
			tracks: {
				id: null,
				value: [tracks[0], tracks[1]],
			},
			crdtResolve: {
				decision: {
					domain_result: {
						selectedOrder: "current",
					},
				},
			},
		});
	});

	it("applies manual order and emits a CRDT resolve command", () => {
		expect(
			reduceResolveTrackOrderConflict(
				{
					conflictId: "conflict:track-order",
					reviewItemId: "review:conflict:track-order",
					selectedOrder: "manual",
					trackIds: ["track:audio", "track:video"],
				},
				null,
				tracks,
			),
		).toMatchObject({
			tracks: {
				id: null,
				value: [tracks[1], tracks[0]],
			},
			crdtResolve: {
				conflict_id: "conflict:track-order",
				decision: {
					action: "resolveTrackOrderConflict",
					review_item_id: "review:conflict:track-order",
					domain_result: {
						type: "track_order_applied",
						selectedOrder: "manual",
						trackIds: ["track:audio", "track:video"],
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
