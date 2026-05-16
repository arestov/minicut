import type {
	MiniCutDktClipSeed,
	MiniCutDktTextSeed,
} from "../../dkt/runtime/seedTypes";
import { defaultClipTransform } from "../Clip/actions";
import { defaultTextBox, defaultTextStyle } from "../Text/defaults";

export type TrackAddClipPayload = MiniCutDktClipSeed & {
	resource?: unknown;
	resourceId?: string | null;
};

export type TrackAddTextClipPayload = MiniCutDktClipSeed & {
	text?: MiniCutDktTextSeed;
};

const asString = (value: unknown): string | null =>
	typeof value === "string" ? value : null;
const asNumber = (value: unknown): number | null =>
	typeof value === "number" ? value : null;
const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" ? (value as Value) : null;
const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;

export const normalizeClipCreationAttrs = (payload: unknown) => {
	const value = payload as TrackAddClipPayload | null;
	return {
		name: asString(value?.name) ?? "Clip",
		color: asString(value?.color) ?? "#2563eb",
		mediaKind: asString(value?.mediaKind),
		start: asNumber(value?.start) ?? 0,
		in: asNumber(value?.in) ?? 0,
		duration: asNumber(value?.duration) ?? 0,
		fadeIn: asNumber(value?.fadeIn) ?? 0,
		fadeOut: asNumber(value?.fadeOut) ?? 0,
		audio: asObject(value?.audio) ?? { gain: 1, pan: 0 },
		opacity: asObject(value?.opacity) ?? { value: 1 },
		transform: asObject(value?.transform) ?? defaultClipTransform,
	};
};

export const normalizeTextCreationAttrs = (payload: unknown) => {
	const value = payload as MiniCutDktTextSeed | null;
	return {
		content: asString(value?.content) ?? "Text",
		style: asObject(value?.style) ?? defaultTextStyle,
		box: asObject(value?.box) ?? defaultTextBox,
	};
};

const getNodeId = (model: unknown): string | null =>
	model &&
	typeof model === "object" &&
	typeof (model as { _node_id?: unknown })._node_id === "string"
		? (model as { _node_id: string })._node_id
		: null;

const getModelAttr = (model: unknown, key: string): unknown => {
	if (!model || typeof model !== "object") {
		return undefined;
	}
	const statesValue = (model as { states?: Record<string, unknown> }).states?.[
		key
	];
	if (statesValue !== undefined) {
		return statesValue;
	}
	return (model as Record<string, unknown>)[key];
};

const resolveOutputRelModel = (payload: unknown, relName: string): unknown => {
	const rels = asRecord((payload as { rels?: unknown } | null)?.rels);
	return rels?.[relName] ?? null;
};

export const removeClipRef = (
	clips: unknown[],
	clipId: unknown,
): unknown[] | null => {
	if (typeof clipId !== "string") return null;
	const idx = clips.findIndex((clip) => getNodeId(clip) === clipId);
	if (idx < 0) return null;
	return clips.filter((_, i) => i !== idx);
};

export const normalizeRightSplitClipAttrs = (payload: unknown) => {
	const value = payload as
		| (TrackAddClipPayload & {
				splitTime?: unknown;
				sourceClip?: { start?: unknown; in?: unknown; duration?: unknown };
		  })
		| null;
	const source = value?.sourceClip;
	const splitTime =
		typeof value?.splitTime === "number"
			? value.splitTime
			: typeof (payload as { time?: unknown } | null)?.time === "number"
				? (payload as { time: number }).time
				: null;
	const sourceStart = asNumber(source?.start) ?? asNumber(value?.start);
	const sourceIn = asNumber(source?.in) ?? asNumber(value?.in) ?? 0;
	const sourceDuration =
		asNumber(source?.duration) ?? asNumber(value?.duration);
	if (splitTime === null || sourceStart === null || sourceDuration === null) {
		return null;
	}
	const sourceEnd = sourceStart + sourceDuration;
	if (splitTime <= sourceStart || splitTime >= sourceEnd) {
		return null;
	}
	return normalizeClipCreationAttrs({
		...value,
		start: splitTime,
		in: sourceIn + (splitTime - sourceStart),
		duration: sourceEnd - splitTime,
	});
};

export const reduceRenameTrack = (payload: unknown) => {
	const name =
		typeof payload === "string"
			? payload
			: (payload as { name?: unknown } | null)?.name;
	return typeof name === "string" && name ? { name } : null;
};

export const reduceSetTrackMuted = (payload: unknown) => {
	const muted =
		typeof payload === "boolean"
			? payload
			: (payload as { muted?: unknown } | null)?.muted;
	return typeof muted === "boolean" ? { muted } : null;
};

export const reduceSetTrackLocked = (payload: unknown) => {
	const locked =
		typeof payload === "boolean"
			? payload
			: (payload as { locked?: unknown } | null)?.locked;
	return typeof locked === "boolean" ? { locked } : null;
};

const resolveResourceRef = (payload: unknown): unknown => {
	const value = payload as { resource?: unknown } | null;
	return value?.resource ?? null;
};

export const reduceAddClip = (payload: unknown, self: unknown) => {
	const attrs = normalizeClipCreationAttrs(payload);
	const resource = resolveResourceRef(payload);
	return {
		clip: {
			attrs,
			rels: { track: self, resource: resource ?? null },
			hold_ref_id: "newClip",
		},
		clips: { use_ref_id: "newClip" },
	};
};

export const reduceAddTextClip = (payload: unknown, self: unknown) => {
	const value = payload as { text?: unknown } | null;
	const clipAttrs = normalizeClipCreationAttrs(payload);
	const textAttrs = normalizeTextCreationAttrs(value?.text);
	return {
		clip: {
			attrs: { ...clipAttrs, mediaKind: "text" },
			rels: { track: self, resource: null },
			hold_ref_id: "newTextClip",
		},
		text: {
			attrs: textAttrs,
			hold_ref_id: "newTextNode",
		},
		clips: { use_ref_id: "newTextClip" },
		$output: {
			rels: {
				clip: { use_ref_id: "newTextClip" },
				text: { use_ref_id: "newTextNode" },
			},
		},
	};
};

export const reduceLinkClipAndTextFromOutput = (payload: unknown) => {
	const clip = resolveOutputRelModel(payload, "clip");
	const text = resolveOutputRelModel(payload, "text");
	const clipId = getNodeId(clip);
	const textId = getNodeId(text);
	if (!clipId || !textId) {
		return null;
	}
	return {
		[clipId]: { rels: { text } },
		[textId]: { rels: { clip } },
	};
};

const cloneTextAttrs = (
	textModel: unknown,
): ReturnType<typeof normalizeTextCreationAttrs> =>
	normalizeTextCreationAttrs({
		content: getModelAttr(textModel, "content"),
		style: getModelAttr(textModel, "style"),
		box: getModelAttr(textModel, "box"),
	});

export const reduceSplitClipAt = (payload: unknown, self: unknown) => {
	const attrs = normalizeRightSplitClipAttrs(payload);
	if (!attrs) {
		return null;
	}
	const resource = (payload as { resource?: unknown } | null)?.resource ?? null;
	const text = (payload as { text?: unknown } | null)?.text ?? null;
	const clonedTextAttrs = text ? cloneTextAttrs(text) : null;
	return {
		clip: {
			attrs,
			rels: {
				track: self,
				resource: resource ?? null,
			},
			hold_ref_id: "rightSplitClip",
		},
		...(clonedTextAttrs
			? {
					text: {
						attrs: clonedTextAttrs,
						hold_ref_id: "rightSplitText",
					},
				}
			: {}),
		clips: { use_ref_id: "rightSplitClip" },
		$output: {
			rels: {
				clip: { use_ref_id: "rightSplitClip" },
				...(clonedTextAttrs ? { text: { use_ref_id: "rightSplitText" } } : {}),
			},
		},
	};
};

export const reduceSetClips = (payload: unknown) => {
	const clips = (payload as { clips?: unknown } | null)?.clips;
	return { clips: Array.isArray(clips) ? clips : [] };
};

export const reduceMoveClipWithinTrack = (
	payload: unknown,
	noop: unknown,
	clips: unknown[],
) => {
	const value = payload as { clipId?: unknown; afterClipId?: unknown } | null;
	const currentClips = Array.isArray(clips) ? clips : [];
	const clipId = value?.clipId;
	const afterClipId = value?.afterClipId ?? null;
	const clip =
		typeof clipId === "string"
			? currentClips.find((item) => getNodeId(item) === clipId)
			: null;
	if (!clip) {
		return noop;
	}
	return {
		clips: {
			id: typeof afterClipId === "string" ? afterClipId : null,
			value: clip,
		},
	};
};

export const reduceSetTrackProject = (payload: unknown) => ({
	project: (payload as { project?: unknown } | null)?.project ?? null,
});

export const reduceAcceptClipIfTarget = (
	payload: unknown,
	self: unknown,
	clips: unknown[],
) => {
	const value = payload as {
		clip?: unknown;
		targetTrack?: unknown;
		targetTrackId?: unknown;
	} | null;
	const targetTrackId =
		getNodeId(value?.targetTrack) ??
		(typeof value?.targetTrackId === "string" ? value.targetTrackId : null);
	const selfId = getNodeId(self);
	const clip = value?.clip;
	const clipId = getNodeId(clip);
	const currentClips = Array.isArray(clips) ? clips : [];
	if (
		!targetTrackId ||
		!selfId ||
		selfId !== targetTrackId ||
		!clip ||
		!clipId
	) {
		return { clips: currentClips };
	}
	if (currentClips.some((candidate) => getNodeId(candidate) === clipId)) {
		return { clips: currentClips };
	}
	return { clips: [...currentClips, clip] };
};

export const reduceRemoveClip = (payload: unknown, clips: unknown[]) => {
	const value = payload as { clipId?: unknown; clip?: unknown } | null;
	const clipId = value?.clipId ?? getNodeId(value?.clip) ?? payload;
	const nextClips = removeClipRef(Array.isArray(clips) ? clips : [], clipId);
	return { clips: nextClips ?? (Array.isArray(clips) ? clips : []) };
};
