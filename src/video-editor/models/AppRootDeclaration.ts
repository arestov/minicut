import { addr } from "dkt/dcl/addr.js";
import { merge as mergeDcl } from "dkt/dcl/merge.js";
import {
	reduceCreateProjectModel,
	reduceCreateActivitySummaryModel,
	reduceCreateReviewItemModel,
	reduceCreateReviewSessionModel,
	reduceAcknowledgeReviewItem,
	reduceHandleCRDTConflict,
	reduceHandleCRDTConflictGraph,
	reduceHandleCRDTSync,
	reduceHandleCRDTSyncGraph,
	reduceLinkReviewSessionItemsFromOutput,
	resolveReviewProjectIdHint,
	reduceSelectReviewItem,
} from "./AppRoot/actions";
import {
	ACTIVITY_SUMMARY_CREATION_SHAPE,
	ActivitySummary,
} from "./ActivitySummary";
import { Clip } from "./Clip";
import { Effect } from "./Effect";
import { PROJECT_CREATION_SHAPE, Project } from "./Project";
import { Resource } from "./Resource";
import { MediaRecoveryTask } from "./MediaRecoveryTask";
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
import { Text } from "./Text";
import { Track } from "./Track";

export const MINICUT_APP_MODELS = [
	EditorSessionRoot,
	Project,
	Track,
	Resource,
	MediaRecoveryTask,
	Clip,
	Text,
	Effect,
	ReviewItem,
	ReviewArchiveEntry,
	ReviewSession,
	ActivitySummary,
] as const;

export const MINICUT_APP_PROPS = mergeDcl({
	init: (target: unknown) => {
		const typedTarget = target as { start_page?: unknown };
		typedTarget.start_page = typedTarget;
	},
	model_name: "app_root",
	models: MINICUT_APP_MODELS,
	rels: {
		$session_root: [
			"input",
			{
				linking: "session_root",
				role: "owner",
				ownership: "slot-single",
				inverseRel: "$parent",
			},
		],
		common_session_root: ["input", { linking: "<< $session_root" }],
		sessions: ["input", { linking: "<< $session_root", many: true }],
		free_sessions: ["input", { linking: "<< $session_root", many: true }],
		project: ["input", { linking: "project", many: true, role: "owner", ownership: "slot-single", inverseRel: "rootOwner" }],
		// Per-device UI state: the project most recently made active by any
		// session. A new session without an active project opens it.
		lastActiveProject: [
			"input",
			{ linking: "project", role: "projection" },
		],
		// Projects some session looks at (user attention for boot media restore).
		attendedProject: [
			"comp",
			[addr({ relPath: ["sessions", "activeProject"], zip: "all" })],
			{ linking: "project", many: true, role: "projection" },
		],
		track: [
			"comp",
			[addr({ relPath: ["project", "tracks"], zip: "all" })],
			{ linking: "track", many: true, role: "projection" },
		],
		resource: [
			"comp",
			[addr({ relPath: ["project", "resources"], zip: "all" })],
			{ linking: "resource", many: true, role: "projection" },
		],
		mediaRecoveryTask: [
			"comp",
			[addr({ relPath: ["project", "resources", "mediaRecoveryTasks"], zip: "all" })],
			{ linking: "media_recovery_task", many: true, role: "projection" },
		],
		clip: [
			"comp",
			[addr({ relPath: ["project", "tracks", "clips"], zip: "all" })],
			{ linking: "clip", many: true, role: "projection" },
		],
		text: [
			"comp",
			[
				addr({
					relPath: ["project", "tracks", "clips", "text"],
					zip: "all",
				}),
			],
			{ linking: "text", many: true, role: "projection" },
		],
		effect: [
			"comp",
			[
				addr({
					relPath: ["project", "tracks", "clips", "effects"],
					zip: "all",
				}),
			],
			{ linking: "effect", many: true, role: "projection" },
		],
		reviewItem: ["input", { linking: "review_item", many: true, role: "owner", ownership: "slot-single", inverseRel: "rootOwner" }],
		reviewArchiveEntry: ["input", { linking: "review_archive_entry", many: true, role: "owner", ownership: "slot-single", inverseRel: "rootOwner" }],
		reviewSession: ["input", { linking: "review_session", many: true, role: "owner", ownership: "slot-single", inverseRel: "rootOwner" }],
		activitySummary: ["input", { linking: "activity_summary", many: true, role: "owner", ownership: "slot-single", inverseRel: "rootOwner" }],
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
			lastActiveProject: { sync: false, reason: "projection" },
			attendedProject: { sync: false, reason: "projection" },
			track: { sync: false, reason: "projection" },
			resource: { sync: false, reason: "projection" },
			mediaRecoveryTask: { sync: false, reason: "projection" },
			clip: { sync: false, reason: "projection" },
			text: { sync: false, reason: "projection" },
			effect: { sync: false, reason: "projection" },
			reviewItem: { sync: false, reason: "projection" },
			reviewArchiveEntry: { sync: false, reason: "projection" },
			reviewSession: { sync: false, reason: "projection" },
			activitySummary: { sync: false, reason: "projection" },
		},
	},
	effects: {
		api: {
			// Optional per platform: absent means no boot media restore.
			mediaRestoreRuntime: [
				["_node_id"] as const,
				["#mediaRestoreRuntime"] as const,
				(mediaRestoreRuntime: unknown) => mediaRestoreRuntime,
			],
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
		createReviewItemModel: {
			to: [
				"<< reviewItem << #",
				{
					method: "at_end",
					can_create: true,
					creation_shape: REVIEW_ITEM_CREATION_SHAPE,
				},
			],
			fn: [
				["$now"] as const,
				(payload: unknown, now: unknown) =>
					reduceCreateReviewItemModel(payload, now),
			],
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
					"$now",
				] as const,
				(
					payload: unknown,
					rootProjectId: unknown,
					projects: unknown,
					now: unknown,
				) =>
					reduceCreateReviewSessionModel(
						payload,
						resolveReviewProjectIdHint(
							payload,
							rootProjectId,
							projects,
						),
						now,
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
					"$now",
				] as const,
				(
					payload: unknown,
					rootProjectId: unknown,
					projects: unknown,
					clips: unknown,
					now: unknown,
				) =>
					reduceHandleCRDTConflict(
						payload,
						resolveReviewProjectIdHint(
							payload,
							rootProjectId,
							projects,
							clips,
						),
						projects,
						clips,
						now,
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
					"$now",
				] as const,
				(
					payload: unknown,
					rootProjectId: unknown,
					projects: unknown,
					now: unknown,
				) =>
					reduceHandleCRDTSync(
						payload,
						resolveReviewProjectIdHint(
							payload,
							rootProjectId,
							projects,
						),
						now,
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
				},
				fn: [
					[
						"$noop",
						"< @one:_node_id < project",
						"<< @all:project",
						"$now",
					] as const,
					(
						payload: unknown,
						noop: unknown,
						rootProjectId: unknown,
						projects: unknown,
						now: unknown,
					) =>
						reduceHandleCRDTSyncGraph(
							payload,
							resolveReviewProjectIdHint(
								payload,
								rootProjectId,
								projects,
							),
							now,
						) ?? noop,
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
						"$now",
					] as const,
					(
						payload: unknown,
						noop: unknown,
						rootProjectId: unknown,
						projects: unknown,
						clips: unknown,
						existingReviewItemIds: unknown,
						now: unknown,
					) =>
						reduceHandleCRDTConflictGraph(
							payload,
							resolveReviewProjectIdHint(
								payload,
								rootProjectId,
								projects,
								clips,
							),
							projects,
							clips,
							existingReviewItemIds,
							now,
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
