import { model } from "dkt/model.js";
import type {
	CrdtConflictStatus,
	MiniCutReviewItem,
	MiniCutReviewKind,
	MiniCutReviewObject,
	MiniCutReviewActionTarget,
} from "../dkt/review/types";
import {
	reduceCreateManualTrackOrderSuggestionOnReviewItem,
	reduceMarkReviewItemResolvedFromConflict,
	reduceSetReviewItem,
} from "./ReviewItem/actions";

const asString = (value: unknown, fallback = ""): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const asArray = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value as Value[]) : [];

const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Value)
		: null;

const asKind = (value: unknown): MiniCutReviewKind =>
	value === "clip_timing" ||
	value === "dangling_resource" ||
	value === "delete_vs_edit" ||
	value === "track_order" ||
	value === "unknown"
		? value
		: "unknown";

const asStatus = (value: unknown): CrdtConflictStatus =>
	value === "acknowledged" || value === "resolved" ? value : "open";

const reduceReviewItemSnapshot = (
	nodeId: unknown,
	reviewItemId: unknown,
	conflictId: unknown,
	projectId: unknown,
	kind: unknown,
	status: unknown,
	title: unknown,
	affectedObjects: unknown,
	preview: unknown,
	availableActions: unknown,
	actionTargets: unknown,
	source: unknown,
): MiniCutReviewItem => {
	const id = asString(reviewItemId, asString(nodeId, ""));
	const resolvedConflictId = asString(conflictId, id);
	return {
		id,
		conflictId: resolvedConflictId,
		projectId: asString(projectId),
		kind: asKind(kind),
		status: asStatus(status),
		title: asString(title, "CRDT conflict"),
		affectedObjects: asArray<MiniCutReviewObject>(affectedObjects),
		preview: preview ?? null,
		availableActions: asArray<string>(availableActions),
		actionTargets:
			asObject<Record<string, MiniCutReviewActionTarget>>(actionTargets) ?? {},
		source:
			source && typeof source === "object"
				? (source as MiniCutReviewItem["source"])
				: { conflictId: resolvedConflictId },
	};
};

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
		"actionTargets",
		"source",
		"createdAt",
		"updatedAt",
	],
} as const;

export const ReviewItem = model({
	model_name: "review_item",
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
		actionTargets: ["input", {}],
		source: ["input", null],
		createdAt: ["input", 0],
		updatedAt: ["input", 0],
		reviewItemSnapshot: [
			"comp",
			[
				"_node_id",
				"reviewItemId",
				"conflictId",
				"projectId",
				"kind",
				"status",
				"title",
				"affectedObjects",
				"preview",
				"availableActions",
				"actionTargets",
				"source",
			] as const,
			reduceReviewItemSnapshot,
		],
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
				actionTargets: ["actionTargets"],
				source: ["source"],
				updatedAt: ["updatedAt"],
			},
			fn: [
				["$noop", "reviewItemId"] as const,
				(payload: unknown, noop: unknown, reviewItemId: unknown) =>
					reduceSetReviewItem(payload, reviewItemId) ?? noop,
			],
		},
		createManualTrackOrderSuggestion: {
			to: {
				preview: ["preview"],
				updatedAt: ["updatedAt"],
			},
			fn: [
				["$noop", "reviewItemId"] as const,
				(payload: unknown, noop: unknown, reviewItemId: unknown) =>
					reduceCreateManualTrackOrderSuggestionOnReviewItem(
						payload,
						noop,
						reviewItemId,
					),
			],
		},
		markResolvedFromConflict: {
			to: {
				conflictId: ["conflictId"],
				status: ["status"],
				updatedAt: ["updatedAt"],
			},
			fn: [
				["$noop", "reviewItemId"] as const,
				(payload: unknown, noop: unknown, reviewItemId: unknown) =>
					reduceMarkReviewItemResolvedFromConflict(
						payload,
						noop,
						reviewItemId,
					),
			],
		},
	},
});
