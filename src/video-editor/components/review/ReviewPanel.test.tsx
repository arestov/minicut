import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MiniCutReviewItem } from "../../dkt/review/types";
import { ReviewPanel } from "./ReviewPanel";

const item: MiniCutReviewItem = {
	id: "review:conflict:1",
	conflictId: "conflict:1",
	projectId: "project:1",
	kind: "clip_timing",
	status: "open",
	title: "Clip timing conflict",
	affectedObjects: [{ type: "clip", id: "clip:1" }],
	preview: {
		type: "clip_timing",
		current: { start: 0, in: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
		incoming: { start: 2, in: 1, duration: 3, fadeIn: 0, fadeOut: 0 },
		fields: ["start", "in", "duration"],
	},
	availableActions: [
		"resolveClipTimingConflict",
		"parkIncomingVariantOnReviewTrack",
	],
	source: { conflictId: "conflict:1", frameId: 2, rootFrameId: 1 },
};

describe("ReviewPanel", () => {
	it("renders ReviewItem state rather than DKT conflict records", () => {
		render(<ReviewPanel items={[item]} />);

		expect(screen.getByRole("region", { name: "Project review" })).toBeInTheDocument();
		expect(screen.getAllByText("Clip timing conflict")).toHaveLength(2);
		expect(screen.getAllByText("clip timing")).toHaveLength(2);
		expect(screen.getByText("conflict:1")).toBeInTheDocument();
	});

	it("routes product review actions without raw CRDT command payloads", async () => {
		const onReviewAction = vi.fn();
		const onAcknowledgeReviewItem = vi.fn();
		render(
			<ReviewPanel
				items={[item]}
				onReviewAction={onReviewAction}
				onAcknowledgeReviewItem={onAcknowledgeReviewItem}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: "Choose incoming" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

		expect(onReviewAction).toHaveBeenCalledWith("resolveClipTimingConflict", item, {
			conflictId: "conflict:1",
			reviewItemId: "review:conflict:1",
			selectedVariant: "incoming",
			start: 2,
			in: 1,
			duration: 3,
			fadeIn: 0,
			fadeOut: 0,
		});
		expect(onAcknowledgeReviewItem).toHaveBeenCalledWith(item);
	});
});
