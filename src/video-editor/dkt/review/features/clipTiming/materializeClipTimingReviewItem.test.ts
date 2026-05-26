import { describe, expect, it } from "vitest";
import type { CrdtConflictRecord } from "../../types";
import { clipTimingConflictFixture } from "./fixtures";
import {
	clipTimingFeature,
	materializeClipTimingReviewItem,
} from "./index";

describe("materializeClipTimingReviewItem", () => {
	it("materializes clip timing conflicts with source metadata", () => {
		const item = materializeClipTimingReviewItem({
			conflict: clipTimingConflictFixture,
			projectId: "project:1",
		});

		expect(item).toMatchObject({
			id: "review:conflict:clip-timing",
			conflictId: "conflict:clip-timing",
			projectId: "project:1",
			kind: "clip_timing",
			status: "open",
			affectedObjects: [{ type: "clip", id: "clip:1", label: "Clip" }],
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
			source: {
				conflictId: "conflict:clip-timing",
				conflictGroupId: "frame:10",
				syncBatchId: "peer-b:batch:1",
				frameId: 11,
				rootFrameId: 10,
			},
		});
		expect(item.preview).toMatchObject({
			type: "clip_timing",
			current: { start: 0, in: 0, duration: 4 },
			incoming: { start: 2, in: 1, duration: 3 },
		});
	});

	it("does not classify structural delete/resource conflicts as timing", () => {
		const conflict: CrdtConflictRecord = {
			...clipTimingConflictFixture,
			kind: "delete_vs_edit",
			aggregate: "clipLifecycle",
		};

		expect(clipTimingFeature.canMaterialize(conflict)).toBe(false);
	});

	it("does not classify resource conflicts with timing-like payloads as clip timing", () => {
		const conflict: CrdtConflictRecord = {
			...clipTimingConflictFixture,
			kind: "dangling_resource",
			aggregate: "resourceLifecycle",
			model_name: "resource",
			field_name: "url",
			payload: {
				current: { start: 0, in: 0, duration: 4 },
				incoming: { start: 2, in: 1, duration: 3 },
			},
		};

		expect(clipTimingFeature.canMaterialize(conflict)).toBe(false);
	});

	it("throws for unsupported timing payloads in materializer tests", () => {
		expect(() =>
			materializeClipTimingReviewItem({
				conflict: {
					...clipTimingConflictFixture,
					payload: { current: { start: 0 }, incoming: { start: 1 } },
				},
				projectId: "project:1",
			}),
		).toThrow("Unsupported clip timing conflict payload");
	});
});
