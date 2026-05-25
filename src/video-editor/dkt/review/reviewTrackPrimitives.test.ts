import { describe, expect, it } from "vitest";
import {
	REVIEW_TRACK_ROLES,
	makeReviewTrackAttrs,
} from "./reviewTrackPrimitives";

describe("review track primitives", () => {
	it("creates disabled, muted incoming review track attrs", () => {
		expect(
			makeReviewTrackAttrs({
				role: REVIEW_TRACK_ROLES.incoming,
				kind: "video",
			}),
		).toMatchObject({
			kind: "video",
			name: "Incoming Review",
			trackRole: "incomingReview",
			enabled: false,
			visibleInPreview: false,
			muted: true,
			isVisible: true,
			locked: false,
		});
	});

	it("creates disabled, muted current review track attrs", () => {
		expect(
			makeReviewTrackAttrs({
				role: REVIEW_TRACK_ROLES.current,
				kind: "audio",
			}),
		).toMatchObject({
			kind: "audio",
			name: "Current Review",
			trackRole: "currentReview",
			enabled: false,
			visibleInPreview: false,
			muted: true,
		});
	});
});
