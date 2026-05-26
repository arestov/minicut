import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import { TrackOrderInspector } from "./TrackOrderInspector";

const item: MiniCutReviewItem = {
	id: "review:conflict:track-order",
	conflictId: "conflict:track-order",
	projectId: "project:1",
	kind: "track_order",
	status: "open",
	title: "Track order changed while offline",
	affectedObjects: [
		{ type: "track", id: "track:video", label: "Video" },
		{ type: "track", id: "track:audio", label: "Audio" },
	],
	preview: {
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
	},
	availableActions: [
		"resolveTrackOrderConflict",
		"preserveCurrentTrackOrder",
		"createManualTrackOrderSuggestion",
	],
	actionTargets: {
		resolveTrackOrderConflict: { type: "project", id: "project:1" },
		preserveCurrentTrackOrder: { type: "project", id: "project:1" },
		createManualTrackOrderSuggestion: { type: "project", id: "project:1" },
	},
	source: { conflictId: "conflict:track-order" },
};

describe("TrackOrderInspector", () => {
	it("shows current and incoming order and applies incoming order", async () => {
		const onApplyOrder = vi.fn();
		render(
			<TrackOrderInspector
				item={item}
				onApplyOrder={onApplyOrder}
				onPreserveCurrentOrder={vi.fn()}
				onCreateManualSuggestion={vi.fn()}
			/>,
		);

		expect(screen.getByText("Current order")).toBeInTheDocument();
		expect(screen.getByText("Incoming order")).toBeInTheDocument();
		expect(screen.getByText("Moved tracks: Audio, Video")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Apply incoming order" }));

		expect(onApplyOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				conflictId: "conflict:track-order",
				reviewItemId: "review:conflict:track-order",
				selectedOrder: "incoming",
				trackIds: ["track:audio", "track:video"],
			}),
		);
	});

	it("saves a manual suggestion without applying it", async () => {
		const onApplyOrder = vi.fn();
		const onCreateManualSuggestion = vi.fn();
		render(
			<TrackOrderInspector
				item={item}
				onApplyOrder={onApplyOrder}
				onPreserveCurrentOrder={vi.fn()}
				onCreateManualSuggestion={onCreateManualSuggestion}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Move Video down" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Save manual suggestion" }),
		);

		expect(onCreateManualSuggestion).toHaveBeenCalledWith(
			expect.objectContaining({
				selectedOrder: "manual",
				trackIds: ["track:audio", "track:video"],
			}),
		);
		expect(onApplyOrder).not.toHaveBeenCalled();
	});
});
