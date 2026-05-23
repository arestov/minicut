import { model } from "dkt/model.js";

export const ACTIVITY_SUMMARY_CREATION_SHAPE = {
	attrs: [
		"activitySummaryId",
		"projectId",
		"batchId",
		"originPeerId",
		"title",
		"created",
		"updated",
		"deleted",
		"rootFrames",
		"happenedAt",
	],
} as const;

export const ActivitySummary = model({
	model_name: "activity_summary",
	attrs: {
		activitySummaryId: ["input", ""],
		projectId: ["input", ""],
		batchId: ["input", ""],
		originPeerId: ["input", ""],
		title: ["input", "Project changes"],
		created: ["input", []],
		updated: ["input", []],
		deleted: ["input", []],
		rootFrames: ["input", []],
		happenedAt: ["input", 0],
	},
});
