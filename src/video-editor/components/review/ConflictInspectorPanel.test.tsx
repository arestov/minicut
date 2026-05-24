import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MiniCutReviewItem } from "../../dkt/review/types";
import { ConflictInspectorPanel } from "./ConflictInspectorPanel";

describe("review ConflictInspectorPanel", () => {
	it("renders a read-only explicit unknown conflict item", () => {
		const item: MiniCutReviewItem = {
			id: "review:unknown",
			conflictId: "conflict:unknown",
			projectId: "project:1",
			kind: "unknown",
			status: "open",
			title: "CRDT conflict",
			affectedObjects: [],
			preview: { type: "unknown_conflict" },
			availableActions: [],
			source: { conflictId: "conflict:unknown" },
		};

		render(<ConflictInspectorPanel item={item} />);

		expect(screen.getByRole("region", { name: "Conflict inspector" })).toBeInTheDocument();
		expect(screen.getByText("unknown conflict")).toBeInTheDocument();
		expect(screen.queryByText("$crdt:resolve")).not.toBeInTheDocument();
	});

	it("shows clip timing alternatives and routes the selected decision", async () => {
		const item: MiniCutReviewItem = {
			id: "review:clip",
			conflictId: "conflict:clip",
			projectId: "project:1",
			kind: "clip_timing",
			status: "open",
			title: "Clip timing conflict",
			affectedObjects: [{ type: "clip", id: "clip:1" }],
			preview: {
				type: "clip_timing",
				payload: {
					current: { start: 0, in: 0, duration: 4 },
					incoming: { start: 2, in: 1, duration: 3 },
				},
			},
			availableActions: ["resolveClipTimingConflict"],
			source: { conflictId: "conflict:clip" },
		};
		const onReviewAction = vi.fn();

		render(
			<ConflictInspectorPanel
				item={item}
				onReviewAction={onReviewAction}
			/>,
		);

		expect(
			screen.getByRole("table", { name: "Timing alternatives" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("columnheader", { name: "Local" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("columnheader", { name: "Incoming" }),
		).toBeInTheDocument();
		expect(screen.getAllByText("0s").length).toBeGreaterThan(0);
		expect(screen.getByText("4s")).toBeInTheDocument();
		expect(screen.getByText("2s")).toBeInTheDocument();
		expect(screen.getByText("1s")).toBeInTheDocument();
		expect(screen.getByText("3s")).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("button", { name: "Use local changes" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Use incoming changes" }),
		);

		expect(onReviewAction).toHaveBeenNthCalledWith(
			1,
			"resolveClipTimingConflict",
			item,
			{ start: 0, in: 0, duration: 4 },
		);
		expect(onReviewAction).toHaveBeenNthCalledWith(
			2,
			"resolveClipTimingConflict",
			item,
			{ start: 2, in: 1, duration: 3 },
		);
	});
});
