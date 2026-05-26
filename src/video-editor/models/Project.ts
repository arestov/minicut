import { model } from "dkt/model.js";
import { crdtReviewResolveTarget } from "../dkt/review/crdtReviewCommands";
import {
	reduceAcceptParkedClipOnReviewTrack,
	reduceParkIncomingVariantOnReviewTrack,
} from "../dkt/review/features/clipTiming/clipTimingActions";
import { CLIP_CREATION_SHAPE } from "./Clip";
import {
	reduceAddEmbeddedAudio,
	reduceAddResourceToTimeline,
	reduceAddTextClipToVideoTrack,
	reduceAddTrack,
	reduceCreateReviewTrack,
	reduceHandleInit,
	reduceEnsureReviewTrack,
	reduceImportResourceCreateOnly,
	reduceEnsureProjectReviewSession,
	reduceMaterializeProjectCRDTConflictReview,
	reduceMoveClipToTrackContext,
	reduceMoveClipToTrackPayload,
	reduceParkEditedVariantOnReviewTrack,
	reducePreserveDeleteAndArchiveIncomingEdit,
	reduceCommitDeleteVsEditRestoreVariant,
	reduceCommitParkEditedVariantOnReviewTrack,
	reduceRenameProject,
	reduceResolveDeleteVsEditByRestoreVariant,
	reduceRequestImportFiles,
	reduceSetImportProgress,
	reduceSetProjectDuration,
	reduceSetProjectFormat,
	reduceSetProjectTrackPreviewEnabled,
	reduceSetResources,
	reduceSetTracks,
	reduceMoveTrackWithinProject,
	reduceResolveTrackOrderConflict,
	reducePreserveCurrentTrackOrder,
} from "./Project/actions";
import { REVIEW_TRACK_ROLES } from "../dkt/review/reviewTrackPrimitives";
import {
	reduceProjectPreviewClipSources,
} from "../read-model/previewComps";
import { RESOURCE_CREATION_SHAPE } from "./Resource";
import { REVIEW_ARCHIVE_ENTRY_CREATION_SHAPE } from "./ReviewArchiveEntry";
import { REVIEW_ITEM_CREATION_SHAPE } from "./ReviewItem";
import { REVIEW_SESSION_CREATION_SHAPE } from "./ReviewSession";
import { TRACK_CREATION_SHAPE } from "./Track";
import {
	finiteNumberOr,
	finiteNumberOrUndefined,
	objectOr,
	stringOr,
} from "./valueGuards";

export const PROJECT_CREATION_SHAPE = {
	attrs: [
		"title",
		"fps",
		"width",
		"height",
		"duration",
		"createdAt",
		"updatedAt",
		"autoCreateDefaultTracks",
	],
	rels: {
		tracks: TRACK_CREATION_SHAPE,
		resources: RESOURCE_CREATION_SHAPE,
		reviewArchiveEntries: REVIEW_ARCHIVE_ENTRY_CREATION_SHAPE,
		reviewItems: REVIEW_ITEM_CREATION_SHAPE,
		reviewSessions: REVIEW_SESSION_CREATION_SHAPE,
	},
} as const;

const RESOURCE_INPUT_BASE_REL_SHAPE = {
	linking: "<< resource << #",
	many: false,
} as const;

const MOVE_CLIP_INPUT_BASE_REL_SHAPE = {
	clipId: {
		any: true,
		many: false,
	},
	targetTrackId: {
		any: true,
		many: false,
	},
} as const;

const CLIP_INPUT_BASE_REL_SHAPE = {
	clipId: {
		any: true,
		many: false,
	},
} as const;

export const Project = model({
	model_name: "project",
	aggregates: {
		projectTracks: {
			kind: "ordered-membership",
			move: "atomic",
			insert: "sequence",
			remove: "tombstone-membership",
		},
		resourceLifecycle: {
			kind: "entity",
			delete: "tombstone",
			concurrentActivity: "conflict",
			orphan: "conflict",
		},
		importPipeline: {
			kind: "pipeline",
			write: "domain-action",
		},
	},
	crdt: {
		mode: "collaborative",
		attrs: {
			title: "lww",
			fps: "lww",
			width: "lww",
			height: "lww",
			duration: "lww",
			createdAt: "lww",
			updatedAt: "lww",
			autoCreateDefaultTracks: { sync: false, reason: "bootstrap-only" },
			importProgress: { sync: false, reason: "pipeline" },
			lastImportError: { sync: false, reason: "pipeline" },
			activeImportTaskId: { sync: false, reason: "effect-runtime" },
			previewFrame: { sync: false, reason: "projection" },
		},
		rels: {
			tracks: ["sequence", { conflictMeta: true }],
			resources: "or-set",
			primaryVideoTrack: "lww",
			primaryAudioTrack: "lww",
			reviewItems: { sync: false, reason: "projection" },
			reviewArchiveEntries: { sync: false, reason: "projection" },
			reviewSessions: { sync: false, reason: "projection" },
		},
	},
	attrs: {
		title: ["input", "Untitled project"],
		fps: ["input", 30],
		width: ["input", 1920],
		height: ["input", 1080],
		duration: ["input", 0],
		timelineDuration: [
			"comp",
			["duration"],
			(duration: number) => duration,
		],
		importProgress: [
			"input",
			null,
			{ aggregate: { name: "importPipeline", as: "importProgress" } },
		],
		lastImportError: [
			"input",
			null,
			{ aggregate: { name: "importPipeline", as: "lastImportError" } },
		],
		activeImportTaskId: [
			"input",
			null,
			{ aggregate: { name: "importPipeline", as: "activeImportTaskId" } },
		],
		previewFrame: ["input", null],
		createdAt: ["input", 0],
		updatedAt: ["input", 0],
		autoCreateDefaultTracks: ["input", false],
		isLandscape: [
			"comp",
			["width", "height"],
			(width: number, height: number) => width >= height,
		],
		resourceTransferManifest: [
			"comp",
			["< @all:transferSnapshot < resources"] as const,
			(snapshots: unknown) => {
				if (!Array.isArray(snapshots)) {
					return [];
				}
				return snapshots
					.map((entry) => {
						const item = entry as {
							resourceId?: unknown;
							name?: unknown;
							kind?: unknown;
							url?: unknown;
							mime?: unknown;
							duration?: unknown;
							width?: unknown;
							height?: unknown;
							size?: unknown;
							source?: unknown;
							status?: unknown;
							data?: unknown;
						} | null;
						if (
							!item ||
							typeof item.resourceId !== "string" ||
							!item.resourceId
						) {
							return null;
						}
						return {
							resourceId: item.resourceId,
							attrs: {
								name: stringOr(item.name, item.resourceId),
								kind:
									item.kind === "audio" ||
									item.kind === "image" ||
									item.kind === "text"
										? item.kind
										: "video",
								url: stringOr(item.url, ""),
								mime:
									stringOr(item.mime, "application/octet-stream"),
								duration: finiteNumberOr(item.duration, 0),
								width: finiteNumberOrUndefined(item.width),
								height: finiteNumberOrUndefined(item.height),
								size: finiteNumberOrUndefined(item.size),
								source: objectOr(item.source, { kind: "local" }),
								status: stringOr(item.status, "missing"),
								data: objectOr(item.data, {}),
							},
						};
					})
					.filter(
						(
							entry,
						): entry is NonNullable<typeof entry> => entry !== null,
					);
			},
		],
		previewClipSources: [
			"comp",
			[
				"< @all:clipRenderData < tracks.clips",
				"< @all:laneRenderState < tracks.clips.track",
			] as const,
			reduceProjectPreviewClipSources,
		],
		reviewOpenItemCount: [
			"comp",
			["< @all:openItemCount < reviewSessions"] as const,
			(counts: unknown) =>
				Array.isArray(counts)
					? counts.reduce(
							(total, count) =>
								total + (typeof count === "number" ? count : 0),
							0,
						)
					: 0,
		],
	},
	rels: {
		tracks: [
			"input",
			{
				many: true,
				linking: "<< track << #",
				role: "owner",
				ownership: "slot-single",
				inverseRel: "project",
				aggregate: {
					name: "projectTracks",
					role: "primary",
					as: "tracks",
					traversal: "owned-subtree",
					conflictAnchor: true,
				},
			},
		],
		resources: [
			"input",
			{
				many: true,
				linking: "<< resource << #",
				role: "owner",
				ownership: "multi",
				inverseRel: "project",
				aggregate: {
					name: "resourceLifecycle",
					role: "primary",
					as: "resources",
					conflictAnchor: true,
				},
			},
		],
		primaryVideoTrack: ["input", { linking: "<< track << #", role: "projection" }],
		primaryAudioTrack: ["input", { linking: "<< track << #", role: "projection" }],
		reviewItems: [
			"sel",
			{
				from: "$root.reviewItem",
				where: {
					">projectId": ["=", "_node_id"],
				},
				rel_shape: {
					many: true,
					linking: "<< reviewItem << #",
					role: "projection",
				},
			},
		],
		reviewArchiveEntries: [
			"sel",
			{
				from: "$root.reviewArchiveEntry",
				where: {
					">projectId": ["=", "_node_id"],
				},
				rel_shape: {
					many: true,
					linking: "<< reviewArchiveEntry << #",
					role: "projection",
				},
			},
		],
		reviewSessions: [
			"sel",
			{
				from: "$root.reviewSession",
				where: {
					">projectId": ["=", "_node_id"],
				},
				rel_shape: {
					many: true,
					linking: "<< reviewSession << #",
					role: "projection",
				},
			},
		],
	},
	actions: {
		handleInit: [
			{
				to: {
					videoTrack: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					audioTrack: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					tracks: [
						"<< tracks",
						{
							method: "set_many",
							can_use_refs: true,
						},
					],
					primaryVideoTrack: [
						"<< primaryVideoTrack",
						{
							method: "set_one",
							can_use_refs: true,
						},
					],
					primaryAudioTrack: [
						"<< primaryAudioTrack",
						{
							method: "set_one",
							can_use_refs: true,
						},
					],
				},
				fn: [
					["$noop", "autoCreateDefaultTracks", "<< @all:tracks"] as const,
					(
						payload: unknown,
						noop: unknown,
						autoCreateDefaultTracks: unknown,
						tracks: unknown,
					) =>
						reduceHandleInit(payload, autoCreateDefaultTracks, tracks) ?? noop,
				],
			},
			{
				to: ["<< tracks", { action: "setProject", sub_flow: true }],
				fn: [
					["<<<<"] as const,
					(_payload: unknown, self: unknown) => ({ project: self }),
				],
			},
		],
		renameProject: {
			to: {
				title: ["title"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceRenameProject(payload) ?? noop,
			],
		},
		setProjectFormat: {
			to: {
				fps: ["fps"],
				width: ["width"],
				height: ["height"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetProjectFormat(payload) ?? noop,
			],
		},
		setProjectDuration: {
			to: {
				duration: ["duration"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetProjectDuration(payload) ?? noop,
			],
		},
		setProjectTimestamps: {
			to: {
				createdAt: ["createdAt"],
				updatedAt: ["updatedAt"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) => {
					if (!payload || typeof payload !== "object") {
						return noop;
					}
					const value = payload as {
						createdAt?: unknown;
						updatedAt?: unknown;
					};
					const result: { createdAt?: number; updatedAt?: number } = {};
					const createdAt = finiteNumberOrUndefined(value.createdAt);
					const updatedAt = finiteNumberOrUndefined(value.updatedAt);
					if (typeof createdAt === "number") {
						result.createdAt = createdAt;
					}
					if (typeof updatedAt === "number") {
						result.updatedAt = updatedAt;
					}
					return Object.keys(result).length ? result : noop;
				},
			],
		},
		addTrack: [
			{
				to: {
					track: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					tracks: [
						"<< tracks",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
				},
				fn: reduceAddTrack,
			},
			{
				to: ["<< tracks", { action: "setProject", sub_flow: true }],
				fn: [
					["<<<<"] as const,
					(_payload: unknown, self: unknown) => ({ project: self }),
				],
			},
		],
		createReviewTrack: [
			{
				to: {
					track: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					tracks: [
						"<< tracks",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
				},
				fn: [
					["$noop"] as const,
					(payload: unknown, noop: unknown) =>
						reduceCreateReviewTrack(payload) ?? noop,
				],
			},
			{
				to: ["<< tracks", { action: "setProject", sub_flow: true }],
				fn: [
					["<<<<"] as const,
					(_payload: unknown, self: unknown) => ({ project: self }),
				],
			},
		],
		ensureIncomingReviewTrack: [
			{
				to: {
					track: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					tracks: [
						"<< tracks",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
				},
				fn: [
					["$noop", "<< @all:tracks"] as const,
					(payload: unknown, noop: unknown, tracks: unknown) =>
						reduceEnsureReviewTrack(
							payload,
							noop,
							tracks,
							REVIEW_TRACK_ROLES.incoming,
						),
				],
			},
			{
				to: ["<< tracks", { action: "setProject", sub_flow: true }],
				fn: [
					["<<<<"] as const,
					(_payload: unknown, self: unknown) => ({ project: self }),
				],
			},
		],
		ensureCurrentReviewTrack: [
			{
				to: {
					track: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					tracks: [
						"<< tracks",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
				},
				fn: [
					["$noop", "<< @all:tracks"] as const,
					(payload: unknown, noop: unknown, tracks: unknown) =>
						reduceEnsureReviewTrack(
							payload,
							noop,
							tracks,
							REVIEW_TRACK_ROLES.current,
						),
				],
			},
			{
				to: ["<< tracks", { action: "setProject", sub_flow: true }],
				fn: [
					["<<<<"] as const,
					(_payload: unknown, self: unknown) => ({ project: self }),
				],
			},
		],
		setTrackPreviewEnabled: {
			to: ["*"],
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetProjectTrackPreviewEnabled(payload) ?? noop,
			],
		},
		requestImportFiles: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "requestImportFiles",
				permission: "entry",
			},
			to: {
				activeImportTaskId: ["activeImportTaskId"],
				importProgress: ["importProgress"],
				lastImportError: ["lastImportError"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceRequestImportFiles(payload) ?? noop,
			],
		},
		setImportProgress: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "setImportProgress",
				permission: "internal",
			},
			to: {
				activeImportTaskId: ["activeImportTaskId"],
				importProgress: ["importProgress"],
				lastImportError: ["lastImportError"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetImportProgress(payload) ?? noop,
			],
		},
		importResource: [
			{
				to: {
					resource: [
						"<< resource << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: RESOURCE_CREATION_SHAPE,
						},
					],
					resources: [
						"<< resources",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
				},
				fn: reduceImportResourceCreateOnly,
			},
			{
				to: ["<< resources", { action: "setProject", sub_flow: true }],
				fn: [
					["<<<<"] as const,
					(_payload: unknown, self: unknown) => ({ project: self }),
				],
			},
		],
		setTracks: {
			to: {
				tracks: ["<< tracks", { method: "set_many" }],
			},
			fn: reduceSetTracks,
		},
		moveTrackWithinProject: {
			to: {
				tracks: ["<< tracks", { method: "at_index" }],
			},
			fn: [
				["$noop", "<< @all:tracks"] as const,
				(payload: unknown, noop: unknown, tracks: unknown) =>
					reduceMoveTrackWithinProject(payload, noop, tracks),
			],
		},
		resolveTrackOrderConflict: {
			to: {
				tracks: [
					"<< tracks",
					{ method: "insert_after_id" },
				],
				crdtResolve: [crdtReviewResolveTarget],
			},
			fn: [
				["$noop", "<< @all:tracks"] as const,
				(payload: unknown, noop: unknown, tracks: unknown) =>
					reduceResolveTrackOrderConflict(payload, noop, tracks),
			],
		},
		preserveCurrentTrackOrder: {
			to: {
				tracks: [
					"<< tracks",
					{ method: "insert_after_id" },
				],
				crdtResolve: [crdtReviewResolveTarget],
			},
			fn: [
				["$noop", "<< @all:tracks"] as const,
				(payload: unknown, noop: unknown, tracks: unknown) =>
					reducePreserveCurrentTrackOrder(payload, noop, tracks),
			],
		},
		createManualTrackOrderSuggestion: [
			{
				to: [
					"<< reviewItems",
					{
						action: "createManualTrackOrderSuggestion",
						sub_flow: true,
					},
				],
				fn: [[], (payload: unknown) => payload ?? {}],
			},
		],
		setResources: {
			to: {
				resources: ["<< resources", { method: "set_many" }],
			},
			fn: reduceSetResources,
		},
		moveClipToTrack: [
			{
				input_base_rel_shape: MOVE_CLIP_INPUT_BASE_REL_SHAPE,
				to: {
					clip: ["*"],
					tracks: ["<< tracks", { action: "removeClip", sub_flow: true }],
					$output: ["$output"],
				},
				fn: [
					[
						"$noop",
						"<<<< $input_id:clipId",
						"<<<< $input_id:targetTrackId",
					] as const,
					reduceMoveClipToTrackContext,
				],
			},
			{
				to: ["<< tracks", { action: "acceptClipIfTarget", sub_flow: true }],
				fn: reduceMoveClipToTrackPayload,
			},
		],
		addResourceToTimeline: [
			{
				input_base_rel_shape: RESOURCE_INPUT_BASE_REL_SHAPE,
				to: {
					clip: [
						"<< clip << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					audioClip: [
						"<< clip << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					videoClips: [
						"<< primaryVideoTrack.clips",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
					audioClips: [
						"<< primaryAudioTrack.clips",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
				},
				fn: [
					[
						"$noop",
						"<<<<",
						"<<<< $input_id",
						"<< @one:primaryVideoTrack",
						"<< @one:primaryAudioTrack",
						"< @one:appendStart < primaryVideoTrack",
						"< @one:appendStart < primaryAudioTrack",
					] as const,
					reduceAddResourceToTimeline,
				],
			},
		],
		addEmbeddedAudioToTimeline: [
			{
				input_base_rel_shape: {
					resourceId: RESOURCE_INPUT_BASE_REL_SHAPE,
				},
				when: [
					[] as const,
					(payload: unknown) =>
						typeof (payload as { resourceId?: unknown } | null)?.resourceId ===
						"string",
				],
				to: ["<< primaryAudioTrack", { action: "addClip", sub_flow: true }],
				fn: [
					[
						"$noop",
						"<<<< $input_id:resourceId",
						"< @one:appendStart < primaryAudioTrack",
						"< @all:resourceId < primaryAudioTrack.clips.clipRenderData",
					] as const,
					reduceAddEmbeddedAudio,
				],
			},
		],
		addTextClipToVideoTrack: [
			{
				to: ["<< primaryVideoTrack", { action: "addTextClip", sub_flow: true }],
				fn: [["<<<<"] as const, reduceAddTextClipToVideoTrack],
			},
		],
		materializeCRDTConflictReview: [
			{
				to: {
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
						"<<<<",
						"<< @one:reviewSessions",
					] as const,
					reduceEnsureProjectReviewSession,
				],
			},
			{
				to: {
					reviewItem: [
						"<< reviewItem << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: REVIEW_ITEM_CREATION_SHAPE,
						},
					],
					sessionItems: [
						"<< @one:reviewSessions.items",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
					selectReviewItem: [
						"<< @one:reviewSessions",
						{
							action: "selectReviewItem",
							sub_flow: true,
						},
					],
				},
				fn: [
					["$noop", "<<<<"] as const,
					reduceMaterializeProjectCRDTConflictReview,
				],
			},
		],
		parkIncomingVariantOnReviewTrack: [
			{
				input_base_rel_shape: CLIP_INPUT_BASE_REL_SHAPE,
				to: {
					reviewTrack: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					reviewTracks: [
						"<< tracks",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
					parkedClip: [
						"<< clip << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					crdtResolve: [crdtReviewResolveTarget],
					next: ["$output", { can_use_refs: true }],
				},
				output_base_rel_shape: {
					clip: {
						linking: "<< clip << #",
						many: false,
					},
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				fn: [
					[
						"$noop",
						"<<<<",
						"<<<< $input_id:clipId",
						"<< @one:resource <<<< $input_id:clipId",
					] as const,
					(
						payload: unknown,
						noop: unknown,
						project: unknown,
						sourceClip: unknown,
						sourceResource: unknown,
					) =>
						reduceParkIncomingVariantOnReviewTrack(
							payload,
							noop,
							project,
							sourceClip,
							sourceResource,
						),
				],
			},
			{
				input_base_rel_shape: {
					clip: {
						linking: "<< clip << #",
						many: false,
					},
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				to: [
					"<<<< $input:targetTrack",
					{ action: "acceptClipIfTarget", sub_flow: true },
				],
				fn: reduceAcceptParkedClipOnReviewTrack,
			},
		],
		resolveDeleteVsEditByRestoreVariant: [
			{
				input_base_rel_shape: {
					targetTrackId: {
						any: true,
						many: false,
					},
				},
				to: {
					clip: [
						"<< clip << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					next: ["$output", { can_use_refs: true }],
				},
				output_base_rel_shape: {
					clip: {
						linking: "<< clip << #",
						many: false,
					},
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				fn: [
					["$noop", "<<<<", "<<<< $input_id:targetTrackId"] as const,
					reduceResolveDeleteVsEditByRestoreVariant,
				],
			},
			{
				input_base_rel_shape: {
					clip: {
						linking: "<< clip << #",
						many: false,
					},
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				to: {
					targetTracks: [
						"<<<< $input:targetTrack",
						{ action: "acceptClipIfTarget", sub_flow: true },
					],
					crdtResolve: [crdtReviewResolveTarget],
				},
				fn: reduceCommitDeleteVsEditRestoreVariant,
			},
		],
		parkEditedVariantOnReviewTrack: [
			{
				to: {
					reviewTrack: [
						"<< track << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					reviewTracks: [
						"<< tracks",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
					parkedClip: [
						"<< clip << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					next: ["$output", { can_use_refs: true }],
				},
				output_base_rel_shape: {
					clip: {
						linking: "<< clip << #",
						many: false,
					},
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				fn: [
					["$noop", "<<<<", "<< @all:tracks"] as const,
					reduceParkEditedVariantOnReviewTrack,
				],
			},
			{
				input_base_rel_shape: {
					clip: {
						linking: "<< clip << #",
						many: false,
					},
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				to: {
					targetTracks: [
						"<<<< $input:targetTrack",
						{ action: "acceptClipIfTarget", sub_flow: true },
					],
					crdtResolve: [crdtReviewResolveTarget],
				},
				fn: reduceCommitParkEditedVariantOnReviewTrack,
			},
		],
		preserveDeleteAndArchiveIncomingEdit: {
			to: {
				reviewArchiveEntry: [
					"<< reviewArchiveEntry << #",
					{
						method: "at_end",
						can_create: true,
						can_hold_refs: true,
						creation_shape: REVIEW_ARCHIVE_ENTRY_CREATION_SHAPE,
					},
				],
				crdtResolve: [crdtReviewResolveTarget],
			},
			fn: [
				["$noop", "<<<<"] as const,
				reducePreserveDeleteAndArchiveIncomingEdit,
			],
		},
	},
});
