import { model } from "dkt/model.js";
import type {
	MiniCutActivitySummary,
	MiniCutReviewObject,
} from "../dkt/review/types";

const asString = (value: unknown, fallback = ""): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const asArray = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value as Value[]) : [];

const reduceActivitySummarySnapshot = (
	nodeId: unknown,
	activitySummaryId: unknown,
	projectId: unknown,
	batchId: unknown,
	originPeerId: unknown,
	title: unknown,
	created: unknown,
	updated: unknown,
	deleted: unknown,
	rootFrames: unknown,
	happenedAt: unknown,
	openedConflictIds: unknown,
	updatedConflictIds: unknown,
): MiniCutActivitySummary => ({
	id: asString(activitySummaryId, asString(nodeId, "")),
	projectId: asString(projectId),
	batchId: asString(batchId),
	originPeerId: asString(originPeerId),
	title: asString(title, "Project changes"),
	created: asArray<MiniCutReviewObject>(created),
	updated: asArray<MiniCutReviewObject>(updated),
	deleted: asArray<MiniCutReviewObject>(deleted),
	rootFrames: asArray(rootFrames),
	happenedAt: typeof happenedAt === "number" ? happenedAt : 0,
	openedConflictIds: asArray<string>(openedConflictIds),
	updatedConflictIds: asArray<string>(updatedConflictIds),
});

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
		"openedConflictIds",
		"updatedConflictIds",
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
		openedConflictIds: ["input", []],
		updatedConflictIds: ["input", []],
		activitySummarySnapshot: [
			"comp",
			[
				"_node_id",
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
				"openedConflictIds",
				"updatedConflictIds",
			] as const,
			reduceActivitySummarySnapshot,
		],
	},
});
