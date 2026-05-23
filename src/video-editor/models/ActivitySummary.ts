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
	crdt: {
		mode: "collaborative",
		attrs: {
			activitySummaryId: { sync: false, reason: "projection" },
			projectId: { sync: false, reason: "projection" },
			batchId: { sync: false, reason: "projection" },
			originPeerId: { sync: false, reason: "projection" },
			title: { sync: false, reason: "projection" },
			created: { sync: false, reason: "projection" },
			updated: { sync: false, reason: "projection" },
			deleted: { sync: false, reason: "projection" },
			rootFrames: { sync: false, reason: "projection" },
			happenedAt: { sync: false, reason: "projection" },
		},
	},
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

