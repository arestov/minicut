import { describe, expect, it } from "vitest";
import {
	normalizeTrackCreationAttrs,
	reduceCreateReviewTrack,
	reduceEnsureReviewTrack,
	reduceSetProjectTrackPreviewEnabled,
} from "./actions";

describe("Project review tracks", () => {
	it("defaults normal tracks to enabled preview attrs", () => {
		expect(normalizeTrackCreationAttrs({ kind: "video", name: "V1" })).toEqual(
			expect.objectContaining({
				trackRole: "normal",
				enabled: true,
				visibleInPreview: true,
			}),
		);
	});

	it("creates disabled review tracks while keeping them in the tracks rel", () => {
		const result = reduceCreateReviewTrack({
			role: "incomingReview",
			kind: "video",
		});

		expect(result).toMatchObject({
			track: {
				attrs: {
					name: "Incoming Review",
					trackRole: "incomingReview",
					enabled: false,
					visibleInPreview: false,
					muted: true,
					isVisible: true,
					locked: false,
				},
			},
			tracks: { use_ref_id: "newReviewTrack" },
		});
	});

	it("does not duplicate an existing review track", () => {
		const noop = Symbol("noop");
		const result = reduceEnsureReviewTrack(
			{},
			noop,
			[{ states: { trackRole: "incomingReview" } }],
			"incomingReview",
		);

		expect(result).toBe(noop);
	});

	it("toggles review track preview attrs together from the project action", () => {
		expect(
			reduceSetProjectTrackPreviewEnabled({
				trackId: "track:review",
				enabled: true,
			}),
		).toEqual({
			"track:review": {
				attrs: {
					enabled: true,
					visibleInPreview: true,
				},
			},
		});
	});
});
