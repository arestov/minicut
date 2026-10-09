import { describe, expect, it } from "vitest";
import type { MiniCutReviewItem } from "../../types";
import {
	formatClipTimingValue,
	readClipTimingResolutionSummary,
	visibleClipTimingFields,
} from "./clipTimingResolution";

const timing = { start: 1, in: 0, duration: 3.12345, fadeIn: 0, fadeOut: 0.5 };

const item = (resolution: unknown): MiniCutReviewItem => ({
	id: "review:1",
	conflictId: "conflict:1",
	projectId: "project:1",
	kind: "clip_timing",
	status: "resolved",
	title: "Clip timing conflict",
	affectedObjects: [],
	preview: null,
	resolution,
	availableActions: [],
	actionTargets: {},
	source: { conflictId: "conflict:1" },
});

describe("clip timing resolution helpers", () => {
	it("formats seconds with at most three decimals", () => {
		expect(formatClipTimingValue(3.12345)).toBe("3.123s");
		expect(formatClipTimingValue(2)).toBe("2s");
	});

	it("shows conflicting fields plus both fades in field order", () => {
		const preview = {
			type: "clip_timing" as const,
			current: timing,
			incoming: timing,
			fields: ["duration", "start"] as never,
		};
		expect(visibleClipTimingFields(preview)).toEqual([
			"start",
			"duration",
			"fadeIn",
			"fadeOut",
		]);
	});

	it("reads the applied timing, variant and parked clip of a resolved item", () => {
		expect(
			readClipTimingResolutionSummary(
				item({
					domain_result: {
						selectedVariant: "incoming",
						sourceTiming: timing,
						parkedClipId: "clip:parked",
					},
				}),
			),
		).toEqual({
			variant: "incoming",
			appliedTiming: timing,
			parkedClipId: "clip:parked",
		});
	});

	it("reports missing details as nulls", () => {
		expect(readClipTimingResolutionSummary(item(null))).toEqual({
			variant: null,
			appliedTiming: null,
			parkedClipId: null,
		});
		expect(
			readClipTimingResolutionSummary(
				item({ domain_result: { variant: "current", sourceTiming: { start: 1 } } }),
			).appliedTiming,
		).toBeNull();
	});
});
