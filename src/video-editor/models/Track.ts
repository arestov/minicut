import { model } from "dkt/model.js";
import { CLIP_CREATION_SHAPE } from "./Clip";
import { TEXT_CREATION_SHAPE } from "./Text";
import {
	reduceAcceptClipIfTarget,
	reduceAddClip,
	reduceAddTextClip,
	reduceLinkClipAndTextFromOutput,
	reduceRemoveClip,
	reduceRenameTrack,
	reduceSetClips,
	reduceSetTrackProject,
	reduceSetTrackLocked,
	reduceSetTrackMuted,
	reduceSplitClipAt,
} from "./Track/actions";
import { reduceTrackAppendStart } from "./Track/comps";

export const TRACK_CREATION_SHAPE = {
	attrs: ["kind", "name", "muted", "locked", "height"],
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
		attrs: {
			kind: "lww",
			name: "lww",
			muted: "lww",
			locked: "lww",
			isVisible: "lww",
			height: "lww",
			trackDuration: null,
			clipCount: null,
			appendStart: null,
		},
		rels: {
			clips: ["sequence", { conflictMeta: true }],
			project: null,
		},
	},
	attrs: {
		kind: ["input", "video"],
		name: ["input", "Track"],
		muted: ["input", false],
		locked: ["input", false],
		isVisible: ["input", true],
		height: ["input", 84],
		trackDuration: ["input", 0],
		clipCount: ["input", 0],
		appendStart: [
			"comp",
			["< @all:start < clips", "< @all:duration < clips"] as const,
			reduceTrackAppendStart,
		],
		laneRenderState: [
			"comp",
			["muted", "locked", "isVisible"],
			(muted: unknown, locked: unknown, isVisible: unknown) => ({
				muted: muted === true,
				locked: locked === true,
				isVisible: isVisible !== false,
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
				},
			},
		],
		project: [
			"input",
			{
				linking: "<< project << #",
				role: "nav",
				inverseRel: "tracks",
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
		addClip: {
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
				clips: [
					"<< clips",
					{
						method: "at_end",
						can_use_refs: true,
					},
				],
			},
			fn: [["<<<<"] as const, reduceAddClip],
		},
		addTextClip: [
			{
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
					text: [
						"<< text << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: TEXT_CREATION_SHAPE,
						},
					],
					clips: [
						"<< clips",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
					$output: ["$output"],
				},
				fn: [
					["$noop", "<<<<"] as const,
					(payload: unknown, noop: unknown, self: unknown) =>
						reduceAddTextClip(payload, self) ?? noop,
				],
			},
			{
				to: ["*"],
				fn: [
					["$noop"] as const,
					(payload: unknown, noop: unknown) =>
						reduceLinkClipAndTextFromOutput(payload) ?? noop,
				],
			},
		],
		splitClipAt: [
			{
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
					text: [
						"<< text << #",
						{
							method: "at_end",
							can_create: true,
							can_hold_refs: true,
							can_use_refs: true,
							creation_shape: TEXT_CREATION_SHAPE,
						},
					],
					clips: [
						"<< clips",
						{
							method: "at_end",
							can_use_refs: true,
						},
					],
					$output: ["$output"],
				},
				fn: [
					["$noop", "<<<<"] as const,
					(payload: unknown, noop: unknown, self: unknown) =>
						reduceSplitClipAt(payload, self) ?? noop,
				],
			},
			{
				to: ["*"],
				fn: [
					["$noop"] as const,
					(payload: unknown, noop: unknown) =>
						reduceLinkClipAndTextFromOutput(payload) ?? noop,
				],
			},
		],
		setClips: {
			to: {
				clips: ["<< clips", { method: "set_many" }],
			},
			fn: reduceSetClips,
		},
		setProject: {
			to: {
				project: ["<< project", { method: "set_one" }],
			},
			fn: reduceSetTrackProject,
		},
		acceptClipIfTarget: {
			to: {
				clips: ["<< clips", { method: "set_many" }],
			},
			fn: [["<<<<", "<< @all:clips"] as const, reduceAcceptClipIfTarget],
		},
		removeClip: {
			to: {
				clips: ["<< clips", { method: "set_many" }],
			},
			fn: [["<< @all:clips"] as const, reduceRemoveClip],
		},
	},
});
