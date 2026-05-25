import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import { ClipTimingConflictInspector } from "./ClipTimingConflictInspector";

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
	source: { conflictId: "conflict:clip" },
};

describe("ClipTimingConflictInspector", () => {
	it("emits domain timing payloads for current, incoming, and parked variants", async () => {
		const onResolve = vi.fn();
		const onParkVariant = vi.fn();

		render(
			<ClipTimingConflictInspector
				item={item}
				onResolve={onResolve}
				onParkVariant={onParkVariant}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Choose current" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Choose incoming" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Park incoming on review track" }),
		);

		expect(onResolve).toHaveBeenNthCalledWith(1, {
			conflictId: "conflict:clip",
			reviewItemId: "review:clip",
			selectedVariant: "current",
			start: 0,
			in: 0,
			duration: 4,
			fadeIn: 0,
			fadeOut: 0,
		});
		expect(onResolve).toHaveBeenNthCalledWith(2, {
			conflictId: "conflict:clip",
			reviewItemId: "review:clip",
			selectedVariant: "incoming",
			start: 2,
			in: 1,
			duration: 3,
			fadeIn: 0,
			fadeOut: 0,
		});
		expect(onParkVariant).toHaveBeenCalledWith({
			conflictId: "conflict:clip",
			reviewItemId: "review:clip",
			clipId: "clip:1",
			variant: "incoming",
			timing: { start: 2, in: 1, duration: 3, fadeIn: 0, fadeOut: 0 },
		});
	});
});
