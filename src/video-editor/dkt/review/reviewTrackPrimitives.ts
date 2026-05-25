export const REVIEW_TRACK_ROLES = {
	incoming: "incomingReview",
	current: "currentReview",
} as const;

export type ReviewTrackRole =
	(typeof REVIEW_TRACK_ROLES)[keyof typeof REVIEW_TRACK_ROLES];

export const makeReviewTrackAttrs = (input: {
	role: ReviewTrackRole;
	kind: "video" | "audio";
}) => ({
	kind: input.kind,
	name: input.role === "incomingReview" ? "Incoming Review" : "Current Review",
	trackRole: input.role,
	enabled: false,
	visibleInPreview: false,
	muted: true,
	locked: false,
	isVisible: true,
	height: 84,
});
