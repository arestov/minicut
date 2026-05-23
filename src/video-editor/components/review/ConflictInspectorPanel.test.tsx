import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});

