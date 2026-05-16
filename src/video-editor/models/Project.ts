import { model } from "dkt/model.js";
import { CLIP_CREATION_SHAPE } from "./Clip";
import {
	reduceAddEmbeddedAudio,
	reduceAddResourceToTimeline,
	reduceAddTextClipToVideoTrack,
	reduceAddTrack,
	reduceHandleInit,
	reduceImportResourceCreateOnly,
	reduceMoveClipToTrackContext,
	reduceMoveClipToTrackPayload,
	reduceRenameProject,
	reduceRequestImportFiles,
	reduceSetImportProgress,
	reduceSetProjectDuration,
	reduceSetProjectFormat,
	reduceSetResources,
	reduceSetTracks,
} from "./Project/actions";
import { reduceProjectPreviewClipSources } from "./Project/comps";
import { RESOURCE_CREATION_SHAPE } from "./Resource";
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

export const Project = model({
	model_name: "project",
	aggregates: {
		projectTracks: {
			kind: "ordered-membership",
		},
		resourceLifecycle: {
			kind: "entity",
		},
		importPipeline: {
			kind: "pipeline",
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
			["< @all:clipRenderData < tracks.clips"] as const,
			reduceProjectPreviewClipSources,
		],
	},
	rels: {
		tracks: [
			"input",
			{
				many: true,
				linking: "<< track << #",
				role: "owner",
				ownership: "multi",
				aggregate: { name: "projectTracks", role: "primary", as: "tracks" },
			},
		],
		resources: [
			"input",
			{
				many: true,
				linking: "<< resource << #",
				role: "owner",
				ownership: "multi",
				aggregate: {
					name: "resourceLifecycle",
					role: "primary",
					as: "resources",
				},
			},
		],
		primaryVideoTrack: ["input", { linking: "<< track << #", role: "projection" }],
		primaryAudioTrack: ["input", { linking: "<< track << #", role: "projection" }],
	},
	actions: {
		handleInit: {
			to: {
				videoTrack: [
					"<< track << #",
					{
						method: "at_end",
						can_create: true,
						can_hold_refs: true,
						creation_shape: TRACK_CREATION_SHAPE,
					},
				],
				audioTrack: [
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
				["$noop", "autoCreateDefaultTracks"] as const,
				(payload: unknown, noop: unknown, autoCreateDefaultTracks: unknown) =>
					reduceHandleInit(payload, autoCreateDefaultTracks) ?? noop,
			],
		},
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
		addTrack: {
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
		requestImportFiles: {
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
		importResource: {
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
		setTracks: {
			to: {
				tracks: ["<< tracks", { method: "set_many" }],
			},
			fn: reduceSetTracks,
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
				fn: reduceAddTextClipToVideoTrack,
			},
		],
	},
});
