import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClipConflictBadge } from "./ClipConflictBadge";

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
