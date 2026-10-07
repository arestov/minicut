import { model } from "dkt/model.js";
import { addr } from "dkt/dcl/addr.js";
import {
	crdtReviewResolveBatchTarget,
	crdtReviewResolveTarget,
} from "../dkt/review/crdtReviewCommands";
import {
	reduceCreateParkedIncomingVariantOnOwner,
	reducePrepareParkedIncomingVariant,
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
	reduceImportResourceCreate,
	reduceImportResourceToAudio,
	reduceImportResourceToEmbeddedAudio,
	reduceImportResourceToVideo,
	reduceEnsureProjectReviewSession,
	reduceMaterializeProjectCRDTConflictReview,
	reduceMoveClipToTrackContext,
	reduceMoveClipToTrackPayload,
	reducePrepareParkEditedVariantOnReviewTrack,
	reduceCreateParkedEditedVariantOnOwner,
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
			rootOwner: { sync: false, reason: "framework-owned" },
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
							assetStorageKind?: unknown;
							assetRef?: unknown;
							contentFingerprint?: unknown;
							fingerprintVersion?: unknown;
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
								assetStorageKind: item.assetStorageKind === "project-copy" ? "project-copy" : "linked",
								assetRef: typeof item.assetRef === "string" ? item.assetRef : null,
								contentFingerprint: typeof item.contentFingerprint === "string" ? item.contentFingerprint : null,
								fingerprintVersion: typeof item.fingerprintVersion === "string" ? item.fingerprintVersion : null,
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
		rootOwner: [
			"input",
			{ linking: "app_root", inverseOf: { app_root: "project" } },
		],
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
				ownership: "slot-single",
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
			"comp",
			[
				addr({
					relPath: ["$root", "reviewItem"],
					where: ["=", "projectId", ["local", "_node_id"]],
					take: "all",
				}),
			],
			{
				many: true,
				linking: "<< reviewItem << #",
				role: "projection",
			},
		],
		reviewArchiveEntries: [
			"comp",
			[
				addr({
					relPath: ["$root", "reviewArchiveEntry"],
					where: ["=", "projectId", ["local", "_node_id"]],
					take: "all",
				}),
			],
			{
				many: true,
				linking: "<< reviewArchiveEntry << #",
				role: "projection",
			},
		],
		reviewSessions: [
			"comp",
			[
				addr({
					relPath: ["$root", "reviewSession"],
					where: ["=", "projectId", ["local", "_node_id"]],
					take: "all",
				}),
			],
			{
				many: true,
				linking: "<< reviewSession << #",
				role: "projection",
			},
		],
	},
	actions: {
		handleInit: [
			{
				to: {
					tracks: [
						"<< tracks",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
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
						"<< tracks",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
				},
				fn: reduceAddTrack,
			},
		],
		createReviewTrack: [
			{
				to: {
					track: [
						"<< tracks",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
				},
				fn: [
					["$noop"] as const,
					(payload: unknown, noop: unknown) =>
						reduceCreateReviewTrack(payload) ?? noop,
				],
			},
		],
		ensureIncomingReviewTrack: [
			{
				to: {
					track: [
						"<< tracks",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
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
		],
		ensureCurrentReviewTrack: [
			{
				to: {
					track: [
						"<< tracks",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
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
						"<< resources",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: RESOURCE_CREATION_SHAPE,
						},
					],
					forwarded: ["$output"],
				},
				output_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				fn: [
					["<< @all:tracks.clips"] as const,
					(payload: unknown, clips: unknown) =>
						reduceImportResourceCreate(
							payload,
							Array.isArray(clips) ? clips : [],
						),
				],
			},
			{
				input_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				to: {
					videoClip: ["<< primaryVideoTrack", { action: "addClip", sub_flow: true }],
					forwarded: ["$output"],
				},
				output_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				fn: [
					["$noop", "<<<< $input:resource", "< @one:appendStart < primaryVideoTrack"] as const,
					(payload: unknown, noop: unknown, resource: unknown, appendStart: unknown) => ({
						videoClip: reduceImportResourceToVideo({ ...(payload as Record<string, unknown>), resource }, noop, [], appendStart),
						forwarded: payload,
					}),
				],
			},
			{
				input_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				to: {
					audioClip: ["<< primaryAudioTrack", { action: "addClip", sub_flow: true }],
					forwarded: ["$output"],
				},
				output_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				fn: [
					["$noop", "<<<< $input:resource", "< @one:appendStart < primaryAudioTrack"] as const,
					(payload: unknown, noop: unknown, resource: unknown, appendStart: unknown) => ({
						audioClip: reduceImportResourceToAudio({ ...(payload as Record<string, unknown>), resource }, noop, [], appendStart),
						forwarded: payload,
					}),
				],
			},
			{
				input_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				to: {
					embeddedAudioClip: ["<< primaryAudioTrack", { action: "addClip", sub_flow: true }],
					forwarded: ["$output"],
				},
				output_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				fn: [
					["$noop", "<<<< $input:resource", "< @one:appendStart < primaryAudioTrack"] as const,
					(payload: unknown, noop: unknown, resource: unknown, appendStart: unknown) => ({
						embeddedAudioClip: reduceImportResourceToEmbeddedAudio(
							{ ...(payload as Record<string, unknown>), resource },
							noop,
							[],
							appendStart,
						),
						forwarded: payload,
					}),
				],
			},
			{
				input_base_rel_shape: { resource: { linking: "<< resources", many: false } },
				to: ["<<<< $input:resource", { action: "startMediaRecovery", sub_flow: true }],
				fn: (payload: unknown) => payload,
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
		resolveDanglingResourceByRelink: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "resolveDanglingResourceByRelink",
				permission: "entry",
			},
			steps: [
				{
					input_base_rel_shape: {
						resourceId: {
							any: true,
							many: false,
						},
					},
					to: [
						"<<<< $input_id:resourceId",
						{ action: "resolveDanglingResourceByRelink", sub_flow: true },
					],
					fn: [[], (payload: unknown) => payload ?? {}],
				},
			],
		},
		keepOfflinePlaceholder: {
			aggregate: {
				name: "importPipeline",
				role: "boundary",
				as: "keepOfflinePlaceholder",
				permission: "entry",
			},
			steps: [
				{
					input_base_rel_shape: {
						resourceId: {
							any: true,
							many: false,
						},
					},
					to: [
						"<<<< $input_id:resourceId",
						{ action: "keepOfflinePlaceholder", sub_flow: true },
					],
					fn: [[], (payload: unknown) => payload ?? {}],
				},
			],
		},
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
					videoClip: [
						"<< primaryVideoTrack",
						{ action: "addClip", sub_flow: true },
					],
					audioClip: [
						"<< primaryAudioTrack",
						{ action: "addClip", sub_flow: true },
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
						"$now",
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
					["$noop", "<<<<", "$now"] as const,
					reduceMaterializeProjectCRDTConflictReview,
				],
			},
		],
		parkIncomingVariantOnReviewTrack: [
			{
				input_base_rel_shape: {
					clipId: {
						any: true,
						many: false,
					},
				},
				to: {
					sourceClip: ["*"],
					reviewTrack: [
						"<< tracks",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					next: ["$output", { can_use_refs: true }],
				},
				output_base_rel_shape: {
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
						"<< @all:reviewItems",
					] as const,
					(
						payload: unknown,
						noop: unknown,
						project: unknown,
						sourceClip: unknown,
						reviewItems: unknown,
					) =>
						reducePrepareParkedIncomingVariant(
							payload,
							noop,
							project,
							sourceClip,
							undefined,
							reviewItems,
						),
				],
			},
			{
				input_base_rel_shape: {
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				to: {
					parkedClip: [
						"<< clips << $input:targetTrack",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					crdtResolve: [crdtReviewResolveBatchTarget],
				},
				fn: [["$noop"] as const, reduceCreateParkedIncomingVariantOnOwner],
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
						"<< clips << $input_id:targetTrackId",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					next: ["$output", { can_use_refs: true }],
				},
				output_base_rel_shape: {
					clip: {
						any: true,
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
						"<< tracks",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: TRACK_CREATION_SHAPE,
						},
					],
					next: ["$output", { can_use_refs: true }],
				},
				output_base_rel_shape: {
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				fn: [
					["$noop", "<<<<", "<< @all:tracks"] as const,
					reducePrepareParkEditedVariantOnReviewTrack,
				],
			},
			{
				input_base_rel_shape: {
					targetTrack: {
						linking: "<< track << #",
						many: false,
					},
				},
				to: {
					parkedClip: [
						"<< clips << $input:targetTrack",
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
					clip: { any: true, many: false },
					targetTrack: { linking: "<< track << #", many: false },
				},
				fn: [["$noop"] as const, reduceCreateParkedEditedVariantOnOwner],
			},
			{
				input_base_rel_shape: {
					clip: { any: true, many: false },
					targetTrack: { linking: "<< track << #", many: false },
				},
				to: { crdtResolve: [crdtReviewResolveTarget] },
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
