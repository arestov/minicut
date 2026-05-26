import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import { DanglingResourceInspector } from "./DanglingResourceInspector";

const item: MiniCutReviewItem = {
	id: "review:resource",
	conflictId: "conflict:resource",
	projectId: "project:1",
	kind: "dangling_resource",
	status: "open",
	title: "Missing media reference",
	affectedObjects: [
		{ type: "resource", id: "resource:1", label: "Interview.mov" },
		{ type: "clip", id: "clip:1", label: "Clip" },
	],
	preview: {
		type: "dangling_resource",
		resourceId: "resource:1",
		resourceName: "Interview.mov",
		resourceKind: "video",
		clipIds: ["clip:1"],
		missingUrl: "file:///missing/interview.mov",
		lastKnownSource: { kind: "file", name: "interview.mov" },
	},
	availableActions: [
		"resolveDanglingResourceByRelink",
		"keepOfflinePlaceholder",
	],
	actionTargets: {
		resolveDanglingResourceByRelink: { type: "clip", id: "clip:1" },
		keepOfflinePlaceholder: { type: "clip", id: "clip:1" },
	},
	source: { conflictId: "conflict:resource" },
};

describe("DanglingResourceInspector", () => {
	it("emits relink and offline-placeholder domain payloads", async () => {
		const onRelink = vi.fn();
		const onKeepPlaceholder = vi.fn();

		render(
			<DanglingResourceInspector
				item={item}
				onRelink={onRelink}
				onKeepPlaceholder={onKeepPlaceholder}
			/>,
		);

		expect(screen.getByText("Interview.mov")).toBeInTheDocument();
		expect(screen.getByText("clip:1")).toBeInTheDocument();
		const relink = screen.getByRole("button", { name: "Relink media" });
		expect(relink).toBeDisabled();

		await userEvent.type(
			screen.getByLabelText("Replacement source"),
			"https://media.example/interview.mov",
		);
		await userEvent.selectOptions(
			screen.getByLabelText("Source kind"),
			"url",
		);
		await userEvent.click(relink);
		await userEvent.click(
			screen.getByRole("button", { name: "Keep offline placeholder" }),
		);

		expect(onRelink).toHaveBeenCalledWith({
			conflictId: "conflict:resource",
			reviewItemId: "review:resource",
			resourceId: "resource:1",
			affectedClipIds: ["clip:1"],
			replacementUrl: "https://media.example/interview.mov",
			source: {
				kind: "url",
				name: "interview.mov",
				url: "https://media.example/interview.mov",
			},
			data: { relinkedFromReview: true },
		});
		expect(onKeepPlaceholder).toHaveBeenCalledWith({
			conflictId: "conflict:resource",
			reviewItemId: "review:resource",
			resourceId: "resource:1",
			affectedClipIds: ["clip:1"],
		});
	});
});
