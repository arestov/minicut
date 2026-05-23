import { model } from "dkt/model.js";
import { ACTIVITY_SUMMARY_CREATION_SHAPE, ActivitySummary } from "./ActivitySummary";
import { REVIEW_ITEM_CREATION_SHAPE, ReviewItem } from "./ReviewItem";
import { reduceSelectReviewItem } from "./ReviewSession/actions";

export const REVIEW_SESSION_CREATION_SHAPE = {
	attrs: [
		"reviewSessionId",
		"projectId",
		"status",
		"selectedReviewItemId",
		"filters",
		"openedAt",
		"updatedAt",
	],
	rels: {
		items: REVIEW_ITEM_CREATION_SHAPE,
		activitySummaries: ACTIVITY_SUMMARY_CREATION_SHAPE,
	},
} as const;

export const ReviewSession = model({
	model_name: "review_session",
	crdt: {
		mode: "collaborative",
		attrs: {
			reviewSessionId: { sync: false, reason: "projection" },
			projectId: { sync: false, reason: "projection" },
			status: { sync: false, reason: "projection" },
			selectedReviewItemId: { sync: false, reason: "projection" },
			filters: { sync: false, reason: "projection" },
			openedAt: { sync: false, reason: "projection" },
			updatedAt: { sync: false, reason: "projection" },
		},
		rels: {
			items: { sync: false, reason: "projection" },
			activitySummaries: { sync: false, reason: "projection" },
		},
	},
	attrs: {
		reviewSessionId: ["input", ""],
		projectId: ["input", ""],
		status: ["input", "open"],
		selectedReviewItemId: ["input", null],
		filters: ["input", { status: "unresolved" }],
		openedAt: ["input", 0],
		updatedAt: ["input", 0],
		openItemCount: [
			"comp",
			["< @all:status < items"] as const,
			(statuses: unknown) =>
				Array.isArray(statuses)
					? statuses.filter((status) => status !== "resolved").length
					: 0,
		],
	},
	rels: {
		items: [
			"input",
			{
				many: true,
				linking: "<< reviewItem << #",
				role: "ref",
			},
		],
		activitySummaries: [
			"input",
			{
				many: true,
				linking: "<< activitySummary << #",
				role: "ref",
			},
		],
	},
	actions: {
		selectReviewItem: {
			to: {
				selectedReviewItemId: ["selectedReviewItemId"],
				updatedAt: ["updatedAt"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSelectReviewItem(payload) ?? noop,
			],
		},
	},
});

