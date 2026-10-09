import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClipConflictBadge } from "./ClipConflictBadge";

describe("ClipConflictBadge", () => {
	it("hides when the clip has no open review items", () => {
		const { container } = render(<ClipConflictBadge count={0} />);

		expect(container).toBeEmptyDOMElement();
	});

	it("shows the open review item count and opens review on click", async () => {
		const onOpen = vi.fn();
		render(<ClipConflictBadge count={2} onOpen={onOpen} />);

		await userEvent.click(screen.getByRole("button", { name: "2 open conflicts" }));

		expect(onOpen).toHaveBeenCalledOnce();
	});
});
