import { model } from "dkt/model.js";
import { ACTIVITY_SUMMARY_CREATION_SHAPE } from "./ActivitySummary";
import { REVIEW_ITEM_CREATION_SHAPE } from "./ReviewItem";
import type {
	MiniCutActivitySummary,
	MiniCutReviewItem,
} from "../dkt/review/types";
import {
	reduceAttachActivitySummaryFromOutput,
	reduceAttachReviewItemFromOutput,
	reduceSelectReviewItem,
} from "./ReviewSession/actions";

export type MiniCutReviewSessionSnapshot = {
	id: string;
	projectId: string;
	selectedReviewItemId: string | null;
	items: MiniCutReviewItem[];
	activitySummaries: MiniCutActivitySummary[];
};

const asString = (value: unknown, fallback = ""): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const reduceReviewSessionSnapshot = (
	nodeId: unknown,
	reviewSessionId: unknown,
	projectId: unknown,
	selectedReviewItemId: unknown,
): MiniCutReviewSessionSnapshot => ({
	id: asString(reviewSessionId, asString(nodeId, "")),
	projectId: asString(projectId),
	selectedReviewItemId:
		typeof selectedReviewItemId === "string" && selectedReviewItemId
			? selectedReviewItemId
			: null,
	items: [],
	activitySummaries: [],
});

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
					? statuses.filter((status) => status === "open").length
					: 0,
		],
		reviewSessionSnapshot: [
			"comp",
			[
				"_node_id",
				"reviewSessionId",
				"projectId",
				"selectedReviewItemId",
			] as const,
			reduceReviewSessionSnapshot,
		],
	},
	rels: {
		rootOwner: [
			"input",
			{ linking: "app_root", inverseOf: { app_root: "reviewSession" } },
		],
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
				["$noop", "$now"] as const,
				(payload: unknown, noop: unknown, now: unknown) =>
					reduceSelectReviewItem(payload, now) ?? noop,
			],
		},
		attachReviewItemFromOutput: {
			to: [
				"<< items",
				{
					method: "at_end",
				},
			],
			fn: [
				["$noop", "<<<<"] as const,
				(payload: unknown, noop: unknown, self: unknown) =>
					reduceAttachReviewItemFromOutput(payload, self) ?? noop,
			],
		},
		attachActivitySummaryFromOutput: {
			to: [
				"<< activitySummaries",
				{
					method: "at_end",
				},
			],
			fn: [
				["$noop", "<<<<"] as const,
				(payload: unknown, noop: unknown, self: unknown) =>
					reduceAttachActivitySummaryFromOutput(payload, self) ?? noop,
			],
		},
	},
});
