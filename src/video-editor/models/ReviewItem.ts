import { model } from "dkt/model.js";
import { reduceSetReviewItem } from "./ReviewItem/actions";

export const REVIEW_ITEM_CREATION_SHAPE = {
	attrs: [
		"reviewItemId",
		"conflictId",
		"projectId",
		"kind",
		"status",
		"title",
		"affectedObjects",
		"preview",
		"availableActions",
		"source",
		"createdAt",
		"updatedAt",
	],
} as const;

export const ReviewItem = model({
	model_name: "review_item",
	crdt: {
		mode: "collaborative",
		attrs: {
			reviewItemId: { sync: false, reason: "projection" },
			conflictId: { sync: false, reason: "projection" },
			projectId: { sync: false, reason: "projection" },
			kind: { sync: false, reason: "projection" },
			status: { sync: false, reason: "projection" },
			title: { sync: false, reason: "projection" },
			affectedObjects: { sync: false, reason: "projection" },
			preview: { sync: false, reason: "projection" },
			availableActions: { sync: false, reason: "projection" },
			source: { sync: false, reason: "projection" },
			createdAt: { sync: false, reason: "projection" },
			updatedAt: { sync: false, reason: "projection" },
		},
	},
	attrs: {
		reviewItemId: ["input", ""],
		conflictId: ["input", ""],
		projectId: ["input", ""],
		kind: ["input", "unknown"],
		status: ["input", "open"],
		title: ["input", "CRDT conflict"],
		affectedObjects: ["input", []],
		preview: ["input", null],
		availableActions: ["input", []],
		source: ["input", null],
		createdAt: ["input", 0],
		updatedAt: ["input", 0],
	},
	actions: {
		setReviewItem: {
			to: {
				reviewItemId: ["reviewItemId"],
				conflictId: ["conflictId"],
				projectId: ["projectId"],
				kind: ["kind"],
				status: ["status"],
				title: ["title"],
				affectedObjects: ["affectedObjects"],
				preview: ["preview"],
				availableActions: ["availableActions"],
				source: ["source"],
				updatedAt: ["updatedAt"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) => reduceSetReviewItem(payload) ?? noop,
			],
		},
	},
});

