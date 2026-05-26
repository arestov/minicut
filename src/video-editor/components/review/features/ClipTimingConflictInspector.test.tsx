import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MiniCutReviewItem } from "../../../dkt/review/types";
import {
	buildClipTimingParkPayload,
	buildClipTimingResolvePayload,
} from "../reviewActionPayloads";
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
	actionTargets: {
		resolveClipTimingConflict: { type: "clip", id: "clip:1" },
		parkIncomingVariantOnReviewTrack: { type: "project", id: "project:1" },
	},
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

		expect(onResolve).toHaveBeenNthCalledWith(
			1,
			buildClipTimingResolvePayload(item, "current"),
		);
		expect(onResolve).toHaveBeenNthCalledWith(
			2,
			buildClipTimingResolvePayload(item, "incoming"),
		);
		expect(onParkVariant).toHaveBeenCalledWith(
			buildClipTimingParkPayload(item),
		);
	});
});
