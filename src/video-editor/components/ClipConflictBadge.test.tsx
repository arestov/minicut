import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClipConflictBadge } from "./ClipConflictBadge";
import { ConflictInspectorPanel, type ClipConflictItem } from "./ConflictInspectorPanel";

describe("ClipConflictBadge", () => {
	it("hides when generated CRDT meta has no open conflicts", () => {
		const { container } = render(
			<ClipConflictBadge model={{ states: {} }} timing={true} />,
		);

		expect(container).toBeEmptyDOMElement();
	});

	it("opens Review UI for timing conflicts without materialize_conflicts", async () => {
		const dispatch = vi.fn();
		const onOpen = vi.fn();
		render(
			<ClipConflictBadge
				model={{
					states: {
						"$meta$aggregates$crdt$clipTiming$open_conflicts_count": 2,
					},
					dispatch,
				}}
				timing={true}
				onOpen={onOpen}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /2 open conflicts/i }));

		expect(dispatch).not.toHaveBeenCalled();
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("opens Review UI for structural and model conflicts without DKT internals", async () => {
		const dispatch = vi.fn();
		const onOpen = vi.fn();
		render(
			<ClipConflictBadge
				model={{
					states: {
						"$meta$aggregates$crdt$timelineMembership$open_conflicts_count": 1,
						"$meta$model$crdt$open_conflicts_count": 3,
					},
					dispatch,
				}}
				scope="all"
				onOpen={onOpen}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /3 open conflicts/i }));

		expect(dispatch).not.toHaveBeenCalled();
		expect(onOpen).toHaveBeenCalledOnce();
	});
});

describe("ConflictInspectorPanel", () => {
	const conflicts: ClipConflictItem[] = [
		{
			id: "conflict:duration",
			kind: "mvr",
			scope: "clipTiming",
			summary: "Duration has concurrent edits",
			decision: { start: 0, in: 0, duration: 3 },
		},
	];

	it("renders the project Review workflow instead of technical conflict controls", async () => {
		const dispatch = vi.fn();
		render(<ConflictInspectorPanel model={{ dispatch }} conflicts={conflicts} />);

		expect(screen.getByRole("region", { name: "Project review" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Load details" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Resolve selected" })).not.toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("button", { name: "resolveClipTimingConflict" }),
		);

		expect(dispatch).toHaveBeenCalledWith("resolveClipTimingConflict", {
			conflict_id: "conflict:duration",
			review_item_id: "review:conflict:duration",
		});
	});

	it("selects review items without batch resolving from the inspector", async () => {
		const dispatch = vi.fn();
		render(
			<ConflictInspectorPanel
				model={{ dispatch }}
				conflicts={[
					...conflicts,
					{
						id: "conflict:start",
						kind: "mvr",
						scope: "clipTiming",
						summary: "Start has concurrent edits",
						decision: { start: 1, in: 0, duration: 3 },
					},
				]}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /Start has concurrent edits/i }));

		expect(screen.getByText("conflict:start")).toBeInTheDocument();
		expect(dispatch).not.toHaveBeenCalledWith(
			"resolveClipTimingConflictsBatch",
			expect.anything(),
		);
	});

	it("does not expose raw structural accept/delete/restore buttons", () => {
		const dispatch = vi.fn();
		render(
			<ConflictInspectorPanel
				model={{ dispatch }}
				conflicts={[
					{
						id: "structural:delete:clip-1",
						kind: "structural_delete_with_concurrent_activity",
						scope: "timelineMembership",
						summary: "Remote delete conflicts with local effect edit",
					},
				]}
			/>,
		);

		expect(
			screen.getAllByText("Remote delete conflicts with local effect edit"),
		).toHaveLength(2);
		expect(screen.queryByRole("button", { name: "Keep local" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Accept delete" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("acknowledges through the Review item action boundary", async () => {
		const dispatch = vi.fn();
		render(
			<ConflictInspectorPanel
				model={{ dispatch }}
				conflicts={conflicts}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

		expect(dispatch).toHaveBeenCalledWith("acknowledgeReviewItem", {
			conflict_id: "conflict:duration",
			review_item_id: "review:conflict:duration",
		});
	});
});
