import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MiniCutActivitySummary } from "../../dkt/review/types";
import { ActivitySummaryPanel } from "./ActivitySummaryPanel";

const summary: MiniCutActivitySummary = {
	id: "activity:batch:1",
	projectId: "project:1",
	batchId: "batch:1",
	originPeerId: "peer-b",
	title: "Timeline changes from peer-b",
	created: [{ type: "clip", id: "clip:1" }],
	updated: [
		{ type: "clip", id: "clip:1", label: "start" },
		{ type: "clip", id: "clip:2", status: "rejected" },
	],
	deleted: [{ type: "resource", id: "resource:1" }],
	rootFrames: [{ frameId: 1, opCount: 2, createCount: 1 }],
	happenedAt: 1,
	openedConflictIds: ["conflict:opened"],
	updatedConflictIds: ["conflict:updated"],
};

describe("ActivitySummaryPanel", () => {
	it("groups activity by batch and renders counts, rejected ops, and conflict links", () => {
		render(<ActivitySummaryPanel summaries={[summary]} />);

		expect(screen.getByText("Batch batch:1")).toBeInTheDocument();
		expect(screen.getByText("Timeline changes from peer-b")).toBeInTheDocument();
		expect(
			screen.getByText("1 created · 2 updated · 1 deleted · 1 rejected"),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "conflict:opened" })).toHaveAttribute(
			"href",
			"#conflict:opened",
		);
		expect(screen.getByRole("link", { name: "conflict:updated" })).toHaveAttribute(
			"href",
			"#conflict:updated",
		);
	});
});
