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
			actionTargets: {},
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
				current: { start: 0, in: 0, duration: 4, fadeIn: 0, fadeOut: 0 },
				incoming: { start: 2, in: 1, duration: 3, fadeIn: 0, fadeOut: 0 },
				fields: ["start", "in", "duration"],
			},
			availableActions: [
				"resolveClipTimingConflict",
				"parkIncomingVariantOnReviewTrack",
			],
			actionTargets: {
				resolveClipTimingConflict: { type: "clip", id: "clip:1" },
				parkIncomingVariantOnReviewTrack: {
					type: "project",
					id: "project:1",
				},
			},
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
			screen.getByRole("table", { name: "Timing variants" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("columnheader", { name: "Current" }),
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
			screen.getByRole("button", { name: "Choose current" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Choose incoming" }),
		);

		expect(onReviewAction).toHaveBeenNthCalledWith(
			1,
			"resolveClipTimingConflict",
			item,
			{
				conflictId: "conflict:clip",
				reviewItemId: "review:clip",
				selectedVariant: "current",
				start: 0,
				in: 0,
				duration: 4,
				fadeIn: 0,
				fadeOut: 0,
			},
		);
		expect(onReviewAction).toHaveBeenNthCalledWith(
			2,
			"resolveClipTimingConflict",
			item,
			{
				conflictId: "conflict:clip",
				reviewItemId: "review:clip",
				selectedVariant: "incoming",
				start: 2,
				in: 1,
				duration: 3,
				fadeIn: 0,
				fadeOut: 0,
			},
		);
	});

	it("shows delete-vs-edit review actions without raw CRDT labels", async () => {
		const item: MiniCutReviewItem = {
			id: "review:delete",
			conflictId: "conflict:delete",
			projectId: "project:1",
			kind: "delete_vs_edit",
			status: "open",
			title: "Deleted item was edited elsewhere",
			affectedObjects: [{ type: "clip", id: "clip:deleted" }],
			preview: {
				type: "delete_vs_edit",
				deletedVariant: { clipId: "clip:deleted" },
				editedVariant: {
					clipAttrs: {
						name: "Edited remote clip",
						targetTrackId: "track:main",
						start: 2,
						duration: 4,
					},
				},
			},
			availableActions: [
				"resolveDeleteVsEditByRestoreVariant",
				"parkEditedVariantOnReviewTrack",
				"preserveDeleteAndArchiveIncomingEdit",
			],
			actionTargets: {
				resolveDeleteVsEditByRestoreVariant: {
					type: "project",
					id: "project:1",
				},
				parkEditedVariantOnReviewTrack: {
					type: "project",
					id: "project:1",
				},
				preserveDeleteAndArchiveIncomingEdit: {
					type: "project",
					id: "project:1",
				},
			},
			source: { conflictId: "conflict:delete" },
		};
		const onReviewAction = vi.fn();

		render(
			<ConflictInspectorPanel
				item={item}
				onReviewAction={onReviewAction}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: "Restore edited variant" }),
		);

		expect(onReviewAction).toHaveBeenCalledWith(
			"resolveDeleteVsEditByRestoreVariant",
			item,
			expect.objectContaining({
				conflictId: "conflict:delete",
				reviewItemId: "review:delete",
				targetTrackId: "track:main",
			}),
		);
		expect(screen.queryByText("$crdt:resolve")).not.toBeInTheDocument();
		expect(screen.queryByText(/accept incoming/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/keep local/i)).not.toBeInTheDocument();
	});
});
