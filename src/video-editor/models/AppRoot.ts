import { appRoot } from "dkt/appRoot.js";
import { merge as mergeDcl } from "dkt/dcl/merge.js";
import {
	reduceCreateClipModel,
	reduceCreateEffectModel,
	reduceCreateProjectModel,
	reduceCreateResourceModel,
	reduceCreateActivitySummaryModel,
	reduceCreateReviewItemModel,
	reduceCreateReviewSessionModel,
	reduceAcknowledgeReviewItem,
	reduceHandleCRDTConflict,
	reduceHandleCRDTConflictGraph,
	reduceHandleCRDTSync,
	reduceHandleCRDTSyncGraph,
	reduceLinkReviewSessionActivityFromOutput,
	reduceLinkReviewSessionItemsFromOutput,
	resolveReviewProjectIdHint,
	reduceCreateTextModel,
	reduceCreateTrackModel,
	reduceSelectReviewItem,
} from "./AppRoot/actions";
import {
	ACTIVITY_SUMMARY_CREATION_SHAPE,
	ActivitySummary,
} from "./ActivitySummary";
import { CLIP_CREATION_SHAPE, Clip } from "./Clip";
import { EFFECT_CREATION_SHAPE, Effect } from "./Effect";
import { PROJECT_CREATION_SHAPE, Project } from "./Project";
import { RESOURCE_CREATION_SHAPE, Resource } from "./Resource";
import {
	REVIEW_ARCHIVE_ENTRY_CREATION_SHAPE,
	ReviewArchiveEntry,
} from "./ReviewArchiveEntry";
import { REVIEW_ITEM_CREATION_SHAPE, ReviewItem } from "./ReviewItem";
import {
	REVIEW_SESSION_CREATION_SHAPE,
	ReviewSession,
} from "./ReviewSession";
import { EditorSessionRoot } from "./SessionRoot";
import { TEXT_CREATION_SHAPE, Text } from "./Text";
import { TRACK_CREATION_SHAPE, Track } from "./Track";

const appProps = mergeDcl({
	init: (target: unknown) => {
		const typedTarget = target as { start_page?: unknown };
		typedTarget.start_page = typedTarget;
	},
	model_name: "app_root",
	rels: {
		$session_root: ["model", EditorSessionRoot],
		common_session_root: ["input", { linking: "<< $session_root" }],
		sessions: ["input", { linking: "<< $session_root", many: true }],
		free_sessions: ["input", { linking: "<< $session_root", many: true }],
		project: ["model", Project, { many: true }],
		track: ["model", Track, { many: true }],
		resource: ["model", Resource, { many: true }],
		clip: ["model", Clip, { many: true }],
		text: ["model", Text, { many: true }],
		effect: ["model", Effect, { many: true }],
		reviewItem: ["model", ReviewItem, { many: true }],
		reviewArchiveEntry: ["model", ReviewArchiveEntry, { many: true }],
		reviewSession: ["model", ReviewSession, { many: true }],
		activitySummary: ["model", ActivitySummary, { many: true }],
	},
	attrs: {
		activeReviewItemId: ["input", null],
		projectMetaList: ["input", []],
		hasProjects: [
			"comp",
			["projectMetaList"],
			(projectMetaList: unknown) =>
				Array.isArray(projectMetaList) && projectMetaList.length > 0,
		],
	},
	crdt: {
		mode: "collaborative",
		attrs: {
			activeReviewItemId: { sync: false, reason: "projection" },
			projectMetaList: { sync: false, reason: "projection" },
		},
		rels: {
			$session_root: { sync: false, reason: "framework-owned" },
			common_session_root: { sync: false, reason: "projection" },
			sessions: { sync: false, reason: "projection" },
			free_sessions: { sync: false, reason: "projection" },
			project: "sequence",
			track: { sync: false, reason: "projection" },
			resource: { sync: false, reason: "projection" },
			clip: { sync: false, reason: "projection" },
			text: { sync: false, reason: "projection" },
			effect: { sync: false, reason: "projection" },
			reviewItem: { sync: false, reason: "projection" },
			reviewArchiveEntry: { sync: false, reason: "projection" },
			reviewSession: { sync: false, reason: "projection" },
			activitySummary: { sync: false, reason: "projection" },
		},
	},
	actions: {
		createProjectModel: {
			to: [
				"<< project << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: PROJECT_CREATION_SHAPE,
				},
			],
			fn: reduceCreateProjectModel,
		},
		createTrackModel: {
			to: [
				"<< track << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: TRACK_CREATION_SHAPE,
				},
			],
			fn: reduceCreateTrackModel,
		},
		createResourceModel: {
			to: [
				"<< resource << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: RESOURCE_CREATION_SHAPE,
				},
			],
			fn: reduceCreateResourceModel,
		},
		createTextModel: {
			to: [
				"<< text << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: TEXT_CREATION_SHAPE,
				},
			],
			fn: reduceCreateTextModel,
		},
		createEffectModel: {
			to: [
				"<< effect << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: EFFECT_CREATION_SHAPE,
				},
			],
			fn: reduceCreateEffectModel,
		},
		createClipModel: {
			to: [
				"<< clip << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: CLIP_CREATION_SHAPE,
				},
			],
			fn: reduceCreateClipModel,
		},
		createReviewItemModel: {
			to: [
				"<< reviewItem << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: REVIEW_ITEM_CREATION_SHAPE,
				},
			],
			fn: reduceCreateReviewItemModel,
		},
		createReviewArchiveEntryModel: {
			to: [
				"<< reviewArchiveEntry << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: REVIEW_ARCHIVE_ENTRY_CREATION_SHAPE,
				},
			],
			fn: (payload: unknown) => payload,
		},
		createActivitySummaryModel: {
			to: [
				"<< activitySummary << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: ACTIVITY_SUMMARY_CREATION_SHAPE,
				},
			],
			fn: reduceCreateActivitySummaryModel,
		},
		openProjectReview: {
			to: [
				"<< reviewSession << #",
				{
					method: "at_end",
					can_create: true,
					can_hold_refs: true,
					creation_shape: REVIEW_SESSION_CREATION_SHAPE,
				},
			],
			fn: [
				[
					"< @one:_node_id < project",
					"<< @all:project",
				] as const,
				(
					payload: unknown,
					rootProjectId: unknown,
					projects: unknown,
				) =>
					reduceCreateReviewSessionModel(
						payload,
						resolveReviewProjectIdHint(
							payload,
							rootProjectId,
							projects,
						),
					),
			],
		},
		materializeCRDTConflictReviewItem: {
			to: [
				"<< reviewItem << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: REVIEW_ITEM_CREATION_SHAPE,
				},
			],
			fn: [
				[
					"< @one:_node_id < project",
					"<< @all:project",
					"<< @all:clip",
				] as const,
				(
					payload: unknown,
					rootProjectId: unknown,
					projects: unknown,
					clips: unknown,
				) =>
					reduceHandleCRDTConflict(
						payload,
						resolveReviewProjectIdHint(
							payload,
							rootProjectId,
							projects,
						),
						projects,
						clips,
					),
			],
		},
		materializeCRDTSyncSummary: {
			to: [
				"<< activitySummary << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: ACTIVITY_SUMMARY_CREATION_SHAPE,
				},
			],
			fn: [
				[
					"< @one:_node_id < project",
					"<< @all:project",
				] as const,
				(
					payload: unknown,
					rootProjectId: unknown,
					projects: unknown,
				) =>
					reduceHandleCRDTSync(
						payload,
						resolveReviewProjectIdHint(
							payload,
							rootProjectId,
							projects,
						),
					),
			],
		},
		handleCRDTSync: [
			{
				to: {
					activitySummaries: [
						"<< activitySummary << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: ACTIVITY_SUMMARY_CREATION_SHAPE,
						},
					],
					reviewSession: [
						"<< reviewSession << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: REVIEW_SESSION_CREATION_SHAPE,
						},
					],
					$output: ["$output"],
				},
				fn: [
					[
						"$noop",
						"< @one:_node_id < project",
						"<< @all:project",
					] as const,
					(
						payload: unknown,
						noop: unknown,
						rootProjectId: unknown,
						projects: unknown,
					) =>
						reduceHandleCRDTSyncGraph(
							payload,
							resolveReviewProjectIdHint(
								payload,
								rootProjectId,
								projects,
							),
						) ?? noop,
				],
			},
			{
				to: ["*"],
				fn: [
					["$noop"] as const,
					(payload: unknown, noop: unknown) =>
						reduceLinkReviewSessionActivityFromOutput(payload) ?? noop,
				],
			},
		],
		handleCRDTConflict: [
			{
				to: {
					reviewItems: [
						"<< reviewItem << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: REVIEW_ITEM_CREATION_SHAPE,
						},
					],
					updateReviewItems: [
						"<< reviewItem",
						{
							action: "setReviewItem",
							sub_flow: true,
						},
					],
					reviewSession: [
						"<< reviewSession << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: REVIEW_SESSION_CREATION_SHAPE,
						},
					],
					$output: ["$output"],
				},
				fn: [
					[
						"$noop",
						"< @one:_node_id < project",
						"<< @all:project",
						"<< @all:clip",
						"< @all:reviewItemId < reviewItem",
					] as const,
					(
						payload: unknown,
						noop: unknown,
						rootProjectId: unknown,
						projects: unknown,
						clips: unknown,
						existingReviewItemIds: unknown,
					) =>
						reduceHandleCRDTConflictGraph(
							payload,
							resolveReviewProjectIdHint(
								payload,
								rootProjectId,
								projects,
							),
							projects,
							clips,
							existingReviewItemIds,
						) ?? noop,
				],
			},
			{
				to: ["*"],
				fn: [
					["$noop"] as const,
					(payload: unknown, noop: unknown) =>
						reduceLinkReviewSessionItemsFromOutput(payload) ?? noop,
				],
			},
		],
		selectReviewItem: {
			to: {
				activeReviewItemId: ["activeReviewItemId"],
			},
			fn: reduceSelectReviewItem,
		},
		acknowledgeReviewItem: {
			to: ["$crdt:acknowledge"],
			fn: [[], reduceAcknowledgeReviewItem],
		},
	},
});

export const MiniCutAppRoot = appRoot(appProps, appProps.init);
