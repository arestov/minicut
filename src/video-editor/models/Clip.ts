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
	aggregates: {
		clipTiming: {
			kind: "group",
			deps: {
				sourceDuration: {
					fromMember: "resource",
					addr: "< duration",
				},
			},
			validate(ctx: {
				members: Record<string, { value: unknown }>;
				phase?: string;
				summary?: { staged_ops?: readonly unknown[] };
				deps?: Record<string, { value: unknown; status?: string }>;
			}) {
				const conflict = (code: string) => ({
					ok: false,
					code,
					kind: "group_invariant_violation",
				});
				const start = Number(ctx.members.start.value);
				const inPoint = Number(ctx.members.inPoint.value);
				const duration = Number(ctx.members.duration.value);
				if (
					!Number.isFinite(start) ||
					!Number.isFinite(inPoint) ||
					!Number.isFinite(duration)
				) {
					if (ctx.phase === "local" && ctx.summary?.staged_ops?.length) {
						return { ok: true };
					}
					return conflict("timing_not_finite");
				}
				if (start < 0) {
					return conflict("start_negative");
				}
				if (inPoint < 0) {
					return conflict("in_negative");
				}
				if (duration <= 0) {
					return conflict("duration_non_positive");
				}
				if (
					ctx.members.resource.value != null &&
					typeof ctx.deps?.sourceDuration?.value === "number" &&
					inPoint + duration > ctx.deps.sourceDuration.value
				) {
					return conflict("clip_exceeds_source_media");
				}
				return { ok: true };
			},
		},
		clipLifecycle: {
			kind: "entity",
			delete: "tombstone",
			concurrentActivity: "conflict",
			ownedSubtree: "include",
		},
	},
	crdt: {
		attrs: {
			name: "lww",
			color: "lww",
			mediaKind: "lww",
			start: ["mvr", { conflictMeta: true }],
			in: ["mvr", { conflictMeta: true }],
			duration: ["mvr", { conflictMeta: true }],
			fadeIn: "lww",
			fadeOut: "lww",
			audio: "lww",
			opacity: "lww",
			transform: "lww",
			splitOriginalDuration: null,
			crop: "lww",
			colorAdjustments: "lww",
		},
		rels: {
			effects: "sequence",
			text: null,
			resource: "lww",
			track: null,
			project: null,
			crdtConflicts: null,
		},
	},
	attrs: {
		name: ["input", "Clip"],
		color: ["input", "#2563eb"],
		mediaKind: ["input", null],
		start: [
			"input",
			0,
			{ aggregate: { name: "clipTiming", as: "start" } },
		],
		in: [
			"input",
			0,
			{ aggregate: { name: "clipTiming", as: "inPoint" } },
		],
		trimStart: ["input", 0],
		duration: [
			"input",
			0,
			{ aggregate: { name: "clipTiming", as: "duration" } },
		],
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
		effects: [
			"input",
			{
				many: true,
				linking: "<< effect << #",
				role: "owner",
				ownership: "slot-single",
				inverseRel: "clip",
				aggregate: {
					name: "clipLifecycle",
					role: "evidence",
					as: "effects",
				},
			},
		],
		text: [
			"input",
			{
				linking: "<< text << #",
				role: "owner",
				ownership: "slot-single",
				inverseRel: "clip",
				aggregate: {
					name: "clipLifecycle",
					role: "evidence",
					as: "text",
				},
			},
		],
		resource: [
			"input",
			{
				linking: "<< resource << #",
				role: "ref",
				deletion: "prevent-delete",
				aggregate: { name: "clipTiming", role: "evidence", as: "resource" },
			},
		],
		track: [
			"input",
			{
				linking: "<< track << #",
				role: "nav",
				inverseRel: "clips",
				aggregate: { name: "timelineMembership", role: "mirror", as: "track" },
			},
		],
		project: ["input", { linking: "<< project << #", role: "nav" }],
		crdtConflicts: [
			"input",
			{
				any: true,
				many: true,
				role: "projection",
			},
		],
	},
	actions: {
		updateOpacity: {
			to: {
				opacity: ["opacity"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceClipUpdateOpacityAction(payload) ?? noop,
			],
		},
		rename: {
			to: {
				name: ["name"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceClipRenameAction(payload) ?? noop,
			],
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
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceClipSetMediaKindAction(payload) ?? noop,
			],
		},
		color: {
			to: {
				color: ["color"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceClipColorAction(payload) ?? noop,
			],
		},
		setFade: {
			to: {
				fadeIn: ["fadeIn"],
				fadeOut: ["fadeOut"],
			},
			fn: [
				["$noop", "fadeIn", "fadeOut", "duration"] as const,
				(
					payload: unknown,
					noop: unknown,
					fadeIn: unknown,
					fadeOut: unknown,
					duration: unknown,
				) => reduceSetFade(payload, fadeIn, fadeOut, duration) ?? noop,
			],
		},
		setAudio: {
			to: {
				audio: ["audio"],
			},
			fn: [
				["$noop", "audio"] as const,
				(payload: unknown, noop: unknown, audio: unknown) =>
					reduceSetAudio(payload, audio) ?? noop,
			],
		},
		setTimelineAttrs: {
			to: {
				start: ["start"],
				in: ["in"],
				duration: ["duration"],
				fadeIn: ["fadeIn"],
				fadeOut: ["fadeOut"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceSetTimelineAttrs(payload) ?? noop,
			],
		},
		setTransform: {
			to: {
				transform: ["transform"],
			},
			fn: [
				["$noop", "transform"] as const,
				(payload: unknown, noop: unknown, transform: unknown) =>
					reduceSetTransform(payload, transform) ?? noop,
			],
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
			fn: [
				["$noop", "start", "in", "duration"] as const,
				(
					payload: unknown,
					noop: unknown,
					start: unknown,
					inPoint: unknown,
					duration: unknown,
				) => reduceTrim(payload, start, inPoint, duration) ?? noop,
			],
		},
		resize: {
			to: {
				start: ["start"],
				in: ["in"],
				duration: ["duration"],
			},
			fn: [
				["$noop", "start", "in", "duration"] as const,
				(
					payload: unknown,
					noop: unknown,
					start: unknown,
					inPoint: unknown,
					duration: unknown,
				) => reduceResize(payload, start, inPoint, duration) ?? noop,
			],
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
				["$noop", "<<<<"] as const,
				(payload: unknown, noop: unknown, self: unknown) => {
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
						: noop;
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
		loadConflicts: {
			to: ["$crdt:materialize_conflicts"],
			fn: [[], (payload: unknown) => payload ?? {}],
		},
		requireConflictDetails: {
			to: ["$crdt:require_details"],
			fn: [[], (payload: unknown) => payload ?? {}],
		},
		acknowledgeConflict: {
			to: ["$crdt:acknowledge"],
			fn: [[], (payload: unknown) => payload ?? {}],
		},
		resolveClipTimingConflict: [
			{
				to: {
					start: ["start"],
					in: ["in"],
					duration: ["duration"],
				},
				fn: [
					["$noop", "start", "in", "duration"] as const,
					(
						payload: unknown,
						noop: unknown,
						start: unknown,
						inPoint: unknown,
						duration: unknown,
					) => {
						const value = payload as {
							start?: unknown;
							in?: unknown;
							duration?: unknown;
						} | null;
						const next = {
							start: numberOr(value?.start, numberOr(start, 0)),
							in: numberOr(value?.in, numberOr(inPoint, 0)),
							duration: numberOr(value?.duration, numberOr(duration, 0)),
						};
						return next;
					},
				],
			},
			{
				to: ["$crdt:resolve"],
				fn: [
					[],
					(payload: unknown) => {
						const value = payload as {
							conflict_id?: unknown;
							conflictId?: unknown;
							decision?: unknown;
						} | null;
						return {
							conflict_id: value?.conflict_id ?? value?.conflictId,
							decision: value?.decision ?? payload,
						};
					},
				],
			},
		],
		resolveClipTimingConflictsBatch: {
			to: ["$crdt:resolve_batch"],
			fn: [[], (payload: unknown) => payload ?? { decisions: [] }],
		},
		clearResolutionAttempt: {
			to: ["$crdt:clear_resolution_attempt"],
			fn: [[], (payload: unknown) => payload ?? {}],
		},
		removeSelf: [
			{
				to: ["<< track", { action: "removeClip", sub_flow: true }],
				fn: [
					["$noop", "_node_id"] as const,
					(_payload: unknown, noop: unknown, clipId: unknown) => {
						if (typeof clipId !== "string") return noop;
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
