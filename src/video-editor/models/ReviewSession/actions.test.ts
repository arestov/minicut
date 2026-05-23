import { describe, expect, it } from "vitest";
import { reduceCreateReviewSession, reduceSelectReviewItem } from "./actions";

describe("ReviewSession actions", () => {
	it("opens project review sessions from active project hint", () => {
		expect(reduceCreateReviewSession({}, "project:1")).toMatchObject({
			attrs: {
				reviewSessionId: "review-session:project:1",
				projectId: "project:1",
				status: "open",
				selectedReviewItemId: null,
				filters: { status: "unresolved" },
			},
		});
	});

	it("selects review items", () => {
		expect(reduceSelectReviewItem({ reviewItemId: "review:1" })).toMatchObject({
			selectedReviewItemId: "review:1",
		});
	});
});

