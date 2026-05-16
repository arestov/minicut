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

	it("materializes timing conflicts through the Clip DKT action", async () => {
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

		expect(dispatch).toHaveBeenCalledWith("loadConflicts", {
			scope: { aggregate: "clipTiming" },
		});
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("materializes structural and model conflicts through the Clip DKT action", async () => {
		const dispatch = vi.fn();
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
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: /3 open conflicts/i }));

		expect(dispatch).toHaveBeenCalledWith("loadConflicts", {
			scope: { model: "clip", include_structural: true },
		});
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

	it("dispatches DKT conflict commands from panel controls", async () => {
		const dispatch = vi.fn();
		render(<ConflictInspectorPanel model={{ dispatch }} conflicts={conflicts} />);

		await userEvent.click(screen.getByRole("button", { name: "Load details" }));
		await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
		await userEvent.clear(screen.getByLabelText("Duration"));
		await userEvent.type(screen.getByLabelText("Duration"), "2.5");
		await userEvent.click(screen.getByRole("button", { name: "Resolve timing" }));
		await userEvent.click(screen.getByRole("button", { name: "Resolve selected" }));

		expect(dispatch).toHaveBeenNthCalledWith(1, "requireConflictDetails", {
			conflict_id: "conflict:duration",
		});
		expect(dispatch).toHaveBeenNthCalledWith(2, "acknowledgeConflict", {
			conflict_id: "conflict:duration",
		});
		expect(dispatch).toHaveBeenNthCalledWith(3, "resolveClipTimingConflict", {
			conflict_id: "conflict:duration",
			start: 0,
			in: 0,
			duration: 2.5,
		});
		expect(dispatch).toHaveBeenNthCalledWith(4, "resolveClipTimingConflictsBatch", {
			atomic: false,
			decisions: [
				{
					conflict_id: "conflict:duration",
					start: 0,
					in: 0,
					duration: 3,
				},
			],
		});
	});

	it("batch resolves only checked conflicts", async () => {
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

		await userEvent.click(screen.getByRole("checkbox", { name: "Select conflict:start" }));
		await userEvent.click(screen.getByRole("button", { name: "Resolve selected" }));

		expect(dispatch).toHaveBeenCalledWith("resolveClipTimingConflictsBatch", {
			atomic: false,
			decisions: [
				{
					conflict_id: "conflict:duration",
					start: 0,
					in: 0,
					duration: 3,
				},
			],
		});
	});

	it("shows and clears CRDT resolution attempt errors", async () => {
		const dispatch = vi.fn();
		render(
			<ConflictInspectorPanel
				model={{
					dispatch,
					states: {
						"$meta$aggregates$crdt$clipTiming$last_resolution_error": {
							code: "duration_non_positive",
						},
					},
				}}
				conflicts={conflicts}
			/>,
		);

		expect(screen.getByText("duration_non_positive")).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("button", { name: "Clear resolution error" }),
		);

		expect(dispatch).toHaveBeenCalledWith("clearResolutionAttempt", {
			aggregate: "clipTiming",
			attrs: ["start", "in", "duration"],
		});
	});
});
