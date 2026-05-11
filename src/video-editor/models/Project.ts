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

const asNumber = (value: unknown, fallback: number): number =>
	typeof value === "number" ? value : fallback;

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
	attrs: {
		title: ["input", "Untitled project"],
		fps: ["input", 30],
		width: ["input", 1920],
		height: ["input", 1080],
		duration: ["input", 0],
		timelineDuration: [
			"comp",
			["duration"],
			(duration: unknown) => asNumber(duration, 0),
		],
		importProgress: ["input", null],
		lastImportError: ["input", null],
		activeImportTaskId: ["input", null],
		previewFrame: ["input", null],
		createdAt: ["input", 0],
		updatedAt: ["input", 0],
		autoCreateDefaultTracks: ["input", false],
		isLandscape: [
			"comp",
			["width", "height"],
			(width: unknown, height: unknown) =>
				asNumber(width, 0) >= asNumber(height, 0),
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
								name:
									typeof item.name === "string" ? item.name : item.resourceId,
								kind:
									item.kind === "audio" ||
									item.kind === "image" ||
									item.kind === "text"
										? item.kind
										: "video",
								url: typeof item.url === "string" ? item.url : "",
								mime:
									typeof item.mime === "string"
										? item.mime
										: "application/octet-stream",
								duration:
									typeof item.duration === "number" &&
									Number.isFinite(item.duration)
										? item.duration
										: 0,
								width:
									typeof item.width === "number" && Number.isFinite(item.width)
										? item.width
										: undefined,
								height:
									typeof item.height === "number" &&
									Number.isFinite(item.height)
										? item.height
										: undefined,
								size:
									typeof item.size === "number" && Number.isFinite(item.size)
										? item.size
										: undefined,
								source:
									item.source && typeof item.source === "object"
										? item.source
										: { kind: "local" },
								status:
									typeof item.status === "string" ? item.status : "missing",
								data:
									item.data && typeof item.data === "object" ? item.data : {},
							},
						};
					})
					.filter(
						(
							entry,
						): entry is {
							resourceId: string;
							attrs: Record<string, unknown>;
						} => entry !== null,
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
		tracks: ["input", { many: true, linking: "<< track << #" }],
		resources: ["input", { many: true, linking: "<< resource << #" }],
		primaryVideoTrack: ["input", { linking: "<< track << #" }],
		primaryAudioTrack: ["input", { linking: "<< track << #" }],
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
			fn: [["autoCreateDefaultTracks"] as const, reduceHandleInit],
		},
		renameProject: {
			to: {
				title: ["title"],
			},
			fn: reduceRenameProject,
		},
		setProjectFormat: {
			to: {
				fps: ["fps"],
				width: ["width"],
				height: ["height"],
			},
			fn: reduceSetProjectFormat,
		},
		setProjectDuration: {
			to: {
				duration: ["duration"],
			},
			fn: reduceSetProjectDuration,
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
			fn: reduceRequestImportFiles,
		},
		setImportProgress: {
			to: {
				activeImportTaskId: ["activeImportTaskId"],
				importProgress: ["importProgress"],
				lastImportError: ["lastImportError"],
			},
			fn: reduceSetImportProgress,
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
