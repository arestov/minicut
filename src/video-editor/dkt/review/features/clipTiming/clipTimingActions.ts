import { makeCrdtResolvePayload } from "../../crdtReviewCommands";
import { parseClipTimingVariant } from "./clipTimingPreview";

const getNodeId = (value: unknown): string | null =>
	value &&
	typeof value === "object" &&
	typeof (value as { _node_id?: unknown })._node_id === "string"
		? (value as { _node_id: string })._node_id
		: null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringOrNull = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const modelAttr = (model: unknown, key: string): unknown => {
	if (!isRecord(model)) {
		return undefined;
	}
	const states = model.states;
	if (isRecord(states) && states[key] !== undefined) {
		return states[key];
	}
	return model[key];
};

const modelRel = (model: unknown, key: string): unknown => {
	if (!isRecord(model)) {
		return null;
	}
	const rels = model.rels;
	if (isRecord(rels) && rels[key] !== undefined) {
		return rels[key];
	}
	return model[key] ?? null;
};

const numberAttr = (model: unknown, key: string, fallback: number): number => {
	const value = modelAttr(model, key);
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const objectAttr = <Value extends object>(
	model: unknown,
	key: string,
	fallback: Value,
): Value => {
	const value = modelAttr(model, key);
	return isRecord(value) ? (value as Value) : fallback;
};

export const reduceParkIncomingVariantOnReviewTrack = (
	payload: unknown,
	noop: unknown,
	project: unknown,
	sourceClip?: unknown,
) => {
	if (!isRecord(payload)) {
		return noop;
	}
	const conflictId = stringOrNull(payload.conflictId);
	const reviewItemId = stringOrNull(payload.reviewItemId);
	const clipId = stringOrNull(payload.clipId) ?? getNodeId(sourceClip);
	const timing = parseClipTimingVariant(payload.timing);
	if (
		!conflictId ||
		!reviewItemId ||
		!clipId ||
		!timing ||
		timing.start < 0 ||
		timing.in < 0 ||
		timing.duration <= 0 ||
		timing.fadeIn < 0 ||
		timing.fadeOut < 0 ||
		timing.fadeIn + timing.fadeOut > timing.duration ||
		getNodeId(sourceClip) !== clipId
	) {
		return noop;
	}
	const sourceName = stringOrNull(modelAttr(sourceClip, "name"));
	const mediaKind = stringOrNull(modelAttr(sourceClip, "mediaKind"));
	return {
		reviewTrack: {
			attrs: {
				kind: mediaKind === "audio" ? "audio" : "video",
				name: `Incoming Review - ${sourceName ?? clipId}`,
				enabled: false,
				muted: true,
				locked: false,
				isVisible: true,
				height: 72,
			},
			rels: { project },
			hold_ref_id: "incomingReviewTrack",
		},
		reviewTracks: { use_ref_id: "incomingReviewTrack" },
		parkedClip: {
			attrs: {
				name: `${sourceName ?? "Clip"} incoming timing`,
				color: stringOrNull(modelAttr(sourceClip, "color")) ?? "#f59e0b",
				mediaKind: mediaKind ?? "video",
				start: timing.start,
				in: timing.in,
				duration: timing.duration,
				fadeIn: timing.fadeIn,
				fadeOut: timing.fadeOut,
				audio: objectAttr(sourceClip, "audio", { gain: 1, pan: 0 }),
				opacity: objectAttr(sourceClip, "opacity", { value: 1 }),
				transform: objectAttr(sourceClip, "transform", {
					x: { value: 0 },
					y: { value: 0 },
					scale: { value: 1 },
					rotation: { value: 0 },
				}),
				trimStart: numberAttr(sourceClip, "trimStart", 0),
				splitOriginalDuration: modelAttr(sourceClip, "splitOriginalDuration") ?? null,
				crop: modelAttr(sourceClip, "crop") ?? null,
				colorAdjustments: modelAttr(sourceClip, "colorAdjustments") ?? null,
			},
			rels: {
				track: { use_ref_id: "incomingReviewTrack" },
				project,
				resource: modelRel(sourceClip, "resource"),
				text: modelRel(sourceClip, "text"),
				effects: Array.isArray(modelRel(sourceClip, "effects"))
					? modelRel(sourceClip, "effects")
					: [],
			},
			hold_ref_id: "parkedIncomingClip",
		},
		reviewTrackClips: { use_ref_id: "parkedIncomingClip" },
		crdtResolve: makeCrdtResolvePayload({
			conflictId,
			reviewItemId,
			action: "parkIncomingVariantOnReviewTrack",
			domainResult: {
				type: "parked_variant",
				parkedClipId: { use_ref_id: "parkedIncomingClip" },
				reviewTrackId: { use_ref_id: "incomingReviewTrack" },
				sourceClipId: clipId,
				variant: "incoming",
			},
		}),
		$output: {
			clipId,
			projectId: getNodeId(project),
		},
	};
};
