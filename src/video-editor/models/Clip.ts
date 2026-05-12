import { model } from "dkt/model.js";
import {
	defaultClipTransform,
	normalizeEffectCreationAttrs,
	reduceClipColorAction,
	reduceClipRenameAction,
	reduceClipSetMediaKindAction,
	reduceClipUpdateOpacityAction,
	reduceMoveBy,
	reduceResize,
	reduceSetAudio,
	reduceSetClipAttrs,
	reduceSetEffects,
	reduceSetFade,
	reduceSetProject,
	reduceSetResource,
	reduceSetText,
	reduceSetTimelineAttrs,
	reduceSetTrack,
	reduceSetTransform,
	reduceSplitAt,
	reduceTrim,
	removeEffectRef,
	reorderEffectRefs,
} from "./Clip/actions";
import { reduceClipRenderData } from "./Clip/comps";
import { EFFECT_CREATION_SHAPE } from "./Effect";
import { numberOr, objectOr, objectOrNull, stringOr } from "./valueGuards";

const roundToTenths = (value: number): number => Math.round(value * 10) / 10;
export const Clip = model({
	model_name: "clip",
	attrs: {
		name: ["input", "Clip"],
		color: ["input", "#2563eb"],
		mediaKind: ["input", null],
		start: ["input", 0],
		in: ["input", 0],
		trimStart: ["input", 0],
		duration: ["input", 0],
		fadeIn: ["input", 0],
		fadeOut: ["input", 0],
		audio: ["input", { gain: 1, pan: 0 }],
		opacity: ["input", { value: 1 }],
		transform: ["input", defaultClipTransform],
		splitOriginalDuration: ["input", null],
		crop: ["input", null],
		colorAdjustments: ["input", null],
		renderInterval: [
			"comp",
			["start", "duration"],
			(start: number, duration: number) => {
				const d = Math.max(0, duration);
				return { start, end: start + d, duration: d };
			},
		],
		renderBox: [
			"comp",
			["transform", "crop"],
			(transform: typeof defaultClipTransform, crop: object | null) => ({
				transform: transform ?? defaultClipTransform,
				crop: objectOrNull(crop),
			}),
		],
		effectStackSummary: ["input", null],
		clipRenderData: [
			"comp",
			[
				"_node_id",
				"mediaKind",
				"name",
				"color",
				"start",
				"in",
				"duration",
				"fadeIn",
				"fadeOut",
				"opacity",
				"transform",
				"audio",
				"< @one:_node_id < resource",
				"< @all:renderInstruction < effects",
				"< @one:renderAttrs < text",
				"< @one:renderSummary < resource",
			] as const,
			reduceClipRenderData,
		],
	},
	rels: {
		effects: ["input", { many: true, linking: "<< effect << #" }],
		text: ["input", { linking: "<< text << #" }],
		resource: ["input", { linking: "<< resource << #" }],
		track: ["input", { linking: "<< track << #" }],
		project: ["input", { linking: "<< project << #" }],
	},
	actions: {
		updateOpacity: {
			to: {
				opacity: ["opacity"],
			},
			fn: (payload: unknown) =>
				reduceClipUpdateOpacityAction(payload) ?? "$noop",
		},
		rename: {
			to: {
				name: ["name"],
			},
			fn: (payload: unknown) => reduceClipRenameAction(payload) ?? "$noop",
		},
		setClipAttrs: {
			to: {
				name: ["name"],
				color: ["color"],
				mediaKind: ["mediaKind"],
				start: ["start"],
				in: ["in"],
				duration: ["duration"],
				fadeIn: ["fadeIn"],
				fadeOut: ["fadeOut"],
				audio: ["audio"],
				opacity: ["opacity"],
				transform: ["transform"],
			},
			fn: reduceSetClipAttrs,
		},
		setMediaKind: {
			to: {
				mediaKind: ["mediaKind"],
			},
			fn: (payload: unknown) =>
				reduceClipSetMediaKindAction(payload) ?? "$noop",
		},
		color: {
			to: {
				color: ["color"],
			},
			fn: (payload: unknown) => reduceClipColorAction(payload) ?? "$noop",
		},
		setFade: {
			to: {
				fadeIn: ["fadeIn"],
				fadeOut: ["fadeOut"],
			},
			fn: [["fadeIn", "fadeOut", "duration"] as const, reduceSetFade],
		},
		setAudio: {
			to: {
				audio: ["audio"],
			},
			fn: [["audio"] as const, reduceSetAudio],
		},
		setTimelineAttrs: {
			to: {
				start: ["start"],
				in: ["in"],
				duration: ["duration"],
				fadeIn: ["fadeIn"],
				fadeOut: ["fadeOut"],
			},
			fn: reduceSetTimelineAttrs,
		},
		setTransform: {
			to: {
				transform: ["transform"],
			},
			fn: [["transform"] as const, reduceSetTransform],
		},
		moveBy: {
			to: {
				start: ["start"],
			},
			fn: [["start", "in", "duration"] as const, reduceMoveBy],
		},
		trim: {
			to: {
				start: ["start"],
				in: ["in"],
				duration: ["duration"],
			},
			fn: [["start", "in", "duration"] as const, reduceTrim],
		},
		resize: {
			to: {
				start: ["start"],
				in: ["in"],
				duration: ["duration"],
			},
			fn: [["start", "in", "duration"] as const, reduceResize],
		},
		splitAt: {
			to: {
				duration: ["duration"],
			},
			fn: [["start", "in", "duration"] as const, reduceSplitAt],
		},
		addEffect: {
			to: {
				effect: [
					"<< effect << #",
					{
						method: "at_end",
						can_create: true,
						can_hold_refs: true,
						creation_shape: EFFECT_CREATION_SHAPE,
					},
				],
				effects: [
					"<< effects",
					{
						method: "at_end",
						can_use_refs: true,
					},
				],
			},
			fn: [
				["<<<<"] as const,
				(payload: unknown, self: unknown) => {
					const attrs = normalizeEffectCreationAttrs(payload);
					return attrs
						? {
								effect: {
									attrs,
									rels: { clip: self },
									hold_ref_id: "newEffect",
								},
								effects: { use_ref_id: "newEffect" },
							}
						: "$noop";
				},
			],
		},
		setResource: {
			to: {
				resource: ["<< resource", { method: "set_one" }],
			},
			fn: reduceSetResource,
		},
		setText: {
			to: {
				text: ["<< text", { method: "set_one" }],
			},
			fn: reduceSetText,
		},
		setTrack: {
			to: {
				track: ["<< track", { method: "set_one" }],
			},
			fn: reduceSetTrack,
		},
		setProject: {
			to: {
				project: ["<< project", { method: "set_one" }],
			},
			fn: reduceSetProject,
		},
		setEffects: {
			to: {
				effects: ["<< effects", { method: "set_many" }],
			},
			fn: reduceSetEffects,
		},
		removeEffect: {
			to: {
				effects: ["<< effects", { method: "set_many" }],
			},
			fn: [
				["<< @all:effects"] as const,
				(payload: unknown, effects: unknown[]) => {
					const effectList = Array.isArray(effects) ? effects : [];
					const effectId =
						(payload as { effectId?: unknown } | null)?.effectId ?? payload;
					const nextEffects = removeEffectRef(effectList, effectId);
					return { effects: nextEffects ?? effectList };
				},
			],
		},
		reorderEffect: {
			to: {
				effects: ["<< effects", { method: "set_many" }],
			},
			fn: [
				["<< @all:effects"] as const,
				(payload: unknown, effects: unknown[]) => {
					const effectList = Array.isArray(effects) ? effects : [];
					const value = payload as {
						effectId?: unknown;
						toIndex?: unknown;
					} | null;
					const nextEffects = reorderEffectRefs(
						effectList,
						value?.effectId,
						value?.toIndex,
					);
					return { effects: nextEffects ?? effectList };
				},
			],
		},
		removeSelf: [
			{
				to: ["<< track", { action: "removeClip", sub_flow: true }],
				fn: [
					["_node_id"] as const,
					(_payload: unknown, clipId: unknown) => {
						if (typeof clipId !== "string") return "$noop";
						return { clipId };
					},
				],
			},
		],
		splitSelfAt: [
			{
				to: {
					duration: ["duration"],
					splitOriginalDuration: ["splitOriginalDuration"],
				},
				fn: [
					[
						"$noop",
						"start",
						"in",
						"duration",
						"name",
						"color",
						"mediaKind",
						"fadeIn",
						"fadeOut",
						"audio",
						"opacity",
						"transform",
					] as const,
					(
						payload: unknown,
						noop: unknown,
						start: unknown,
						_inPoint: unknown,
						duration: unknown,
						_name: unknown,
						_color: unknown,
						_mediaKind: unknown,
						_fadeIn: unknown,
						_fadeOut: unknown,
						_audio: unknown,
						_opacity: unknown,
						_transform: unknown,
					) => {
						const time = (payload as { time?: unknown } | null)?.time;
						const s = numberOr(start, 0);
						const d = numberOr(duration, 0);
						if (typeof time !== "number" || time <= s || time >= s + d)
							return noop;
						return {
							duration: roundToTenths(time - s),
							splitOriginalDuration: d,
						};
					},
				],
			},
			{
				to: ["<< track", { action: "splitClipAt", sub_flow: true }],
				fn: [
					[
						"$noop",
						"start",
						"in",
						"duration",
						"splitOriginalDuration",
						"name",
						"color",
						"mediaKind",
						"fadeIn",
						"fadeOut",
						"audio",
						"opacity",
						"transform",
						"<< @one:resource",
						"<< @one:text",
					] as const,
					(
						_payload: unknown,
						noop: unknown,
						start: unknown,
						inPoint: unknown,
						duration: unknown,
						splitOriginalDuration: unknown,
						name: unknown,
						color: unknown,
						mediaKind: unknown,
						_fadeIn: unknown,
						fadeOut: unknown,
						audio: unknown,
						opacity: unknown,
						transform: unknown,
						resource: unknown,
						text: unknown,
					) => {
						const s = numberOr(start, 0);
						const ip = numberOr(inPoint, 0);
						const leftDuration = numberOr(duration, 0);
						const originalDuration = numberOr(splitOriginalDuration, 0);
						if (
							!Number.isFinite(originalDuration) ||
							originalDuration <= leftDuration ||
							leftDuration <= 0
						) {
							return noop;
						}
						const splitTime = roundToTenths(s + leftDuration);
						const rightDuration = roundToTenths(
							originalDuration - leftDuration,
						);
						return {
							name: stringOr(name, "Clip"),
							color: stringOr(color, "#2563eb"),
							mediaKind: stringOr(mediaKind, "video"),
							start: splitTime,
							in: roundToTenths(ip + leftDuration),
							duration: rightDuration,
							fadeIn: 0,
							fadeOut: numberOr(fadeOut, 0),
							audio: objectOr(audio, { gain: 1, pan: 0 }),
							opacity: objectOr(opacity, { value: 1 }),
							transform: objectOr(transform, defaultClipTransform),
							resource,
							text,
							splitTime,
							sourceClip: { start: s, in: ip, duration: originalDuration },
						};
					},
				],
			},
			{
				to: {
					splitOriginalDuration: ["splitOriginalDuration"],
				},
				fn: () => ({ splitOriginalDuration: null }),
			},
		],
	},
});

export const CLIP_CREATION_SHAPE = {
	attrs: [
		"name",
		"color",
		"mediaKind",
		"start",
		"in",
		"duration",
		"fadeIn",
		"fadeOut",
		"audio",
		"opacity",
		"transform",
	],
	rels: {
		track: {},
		resource: {},
		text: {},
		effects: {},
	},
} as const;
