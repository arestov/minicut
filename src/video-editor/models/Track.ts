import { model } from "dkt/model.js";
import { CLIP_CREATION_SHAPE } from "./Clip";
import {
	reduceAcceptClipIfTarget,
	reduceAddClip,
	reduceAddTextClip,
	reduceCreateTextOnClipFromOutput,
	reduceMoveClipWithinTrack,
	reduceRemoveClip,
	reduceRenameTrack,
	reduceSetClips,
	reduceSetTrackLocked,
	reduceSetTrackMuted,
	reduceSetTrackPreviewEnabled,
	reduceSplitClipAt,
} from "./Track/actions";
import { reduceTrackAppendStart } from "./Track/comps";
import { TEXT_CREATION_SHAPE } from "./Text";

export const TRACK_CREATION_SHAPE = {
	attrs: [
		"kind",
		"name",
		"muted",
		"locked",
		"isVisible",
		"height",
		"trackRole",
		"enabled",
		"visibleInPreview",
	],
	rels: {
		project: {},
	},
} as const;

export const Track = model({
	model_name: "track",
	aggregates: {
		timelineMembership: {
			kind: "ordered-membership",
			move: "atomic",
			insert: "sequence",
			remove: "tombstone-membership",
		},
	},
	crdt: {
		mode: "collaborative",
		attrs: {
			kind: "lww",
			name: "lww",
			muted: "lww",
			locked: "lww",
			enabled: "lww",
			isVisible: "lww",
			height: "lww",
			trackRole: "lww",
			visibleInPreview: "lww",
			trackDuration: { sync: false, reason: "projection" },
			clipCount: { sync: false, reason: "projection" },
		},
		rels: {
			clips: ["sequence", { conflictMeta: true }],
			project: { sync: false, reason: "framework-owned" },
		},
	},
	attrs: {
		kind: ["input", "video"],
		name: ["input", "Track"],
		muted: ["input", false],
		locked: ["input", false],
		enabled: ["input", true],
		isVisible: ["input", true],
		height: ["input", 84],
		trackRole: ["input", "normal"],
		visibleInPreview: ["input", true],
		trackDuration: ["input", 0],
		clipCount: ["input", 0],
		appendStart: [
			"comp",
			["< @all:start < clips", "< @all:duration < clips"] as const,
			reduceTrackAppendStart,
		],
		laneRenderState: [
			"comp",
			[
				"muted",
				"locked",
				"isVisible",
				"enabled",
				"visibleInPreview",
				"trackRole",
			],
			(
				muted: unknown,
				locked: unknown,
				isVisible: unknown,
				enabled: unknown,
				visibleInPreview: unknown,
				trackRole: unknown,
			) => ({
				muted: muted === true,
				locked: locked === true,
				isVisible: isVisible !== false,
				enabled: enabled !== false,
				visibleInPreview: visibleInPreview !== false,
				trackRole:
					trackRole === "incomingReview" || trackRole === "currentReview"
						? trackRole
						: "normal",
			}),
		],
	},
	rels: {
		clips: [
			"input",
			{
				many: true,
				linking: "<< clip << #",
				role: "owner",
				ownership: "slot-single",
				inverseRel: "track",
				aggregate: {
					name: "timelineMembership",
					role: "primary",
					as: "clips",
					traversal: "owned-subtree",
					conflictAnchor: true,
				},
			},
		],
		project: [
			"input",
			{
				linking: "<< project << #",
				inverseRel: "tracks",
				inverseOf: { project: "tracks" },
				aggregate: { name: "projectTracks", role: "mirror", as: "project" },
			},
		],
	},
	actions: {
		renameTrack: {
			to: {
				name: ["name"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceRenameTrack(payload) ?? noop,
			],
		},
		setTrackMuted: {
			to: {
				muted: ["muted"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetTrackMuted(payload) ?? noop,
			],
		},
		setTrackLocked: {
			to: {
				locked: ["locked"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetTrackLocked(payload) ?? noop,
			],
		},
		setTrackPreviewEnabled: {
			to: {
				enabled: ["enabled"],
				visibleInPreview: ["visibleInPreview"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetTrackPreviewEnabled(payload) ?? noop,
			],
		},
		addClip: {
			to: [
				"<< clips",
				{
					method: "at_end",
					can_create: true,
					creation_shape: CLIP_CREATION_SHAPE,
				},
			],
			fn: reduceAddClip,
		},
		addTextClip: [
			{
				to: {
					createdClip: [
						"<< clips",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					forwarded: ["$output"],
				},
				output_base_rel_shape: {
					clip: { linking: "<< clips", many: false },
				},
				fn: reduceAddTextClip,
			},
			{
				input_base_rel_shape: {
					clip: { linking: "<< clips", many: false },
				},
				to: [
					"<< text << $input:clip",
					{ method: "set_one", can_create: true, creation_shape: TEXT_CREATION_SHAPE },
				],
				fn: reduceCreateTextOnClipFromOutput,
			},
		],
		splitClipAt: [
			{
				to: {
					createdClip: [
						"<< clips",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							creation_shape: CLIP_CREATION_SHAPE,
						},
					],
					forwarded: ["$output"],
				},
				output_base_rel_shape: {
					clip: { linking: "<< clips", many: false },
				},
				fn: reduceSplitClipAt,
			},
			{
				input_base_rel_shape: {
					clip: { linking: "<< clips", many: false },
				},
				when: [
					[] as const,
					(payload: unknown) =>
						Boolean((payload as { textAttrs?: unknown } | null)?.textAttrs),
				],
				to: [
					"<< text << $input:clip",
					{ method: "set_one", can_create: true, creation_shape: TEXT_CREATION_SHAPE },
				],
				fn: reduceCreateTextOnClipFromOutput,
			},
		],
		setClips: {
			to: {
				clips: ["<< clips", { method: "set_many" }],
			},
			fn: reduceSetClips,
		},
		moveClipWithinTrack: {
			to: {
				clips: ["<< clips", { method: "insert_after_id" }],
			},
			fn: [["$noop", "<< @all:clips"] as const, reduceMoveClipWithinTrack],
		},
		acceptClipIfTarget: {
			to: {
				clips: ["<< clips", { method: "at_end", can_use_refs: true }],
			},
			fn: [["$noop", "<<<<", "<< @all:clips"] as const, reduceAcceptClipIfTarget],
		},
		removeClip: {
			to: {
				clips: ["<< clips", { method: "set_many" }],
			},
			fn: [["<< @all:clips"] as const, reduceRemoveClip],
		},
	},
});
