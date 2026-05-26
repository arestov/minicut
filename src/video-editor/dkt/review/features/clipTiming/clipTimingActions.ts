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

const modelOneRel = (model: unknown, key: string): unknown => {
	const value = modelRel(model, key);
	return Array.isArray(value) ? value[0] ?? null : value;
};

const creationRel = (value: unknown): unknown =>
	isRecord(value) &&
	(typeof value._node_id === "string" || "use_ref_id" in value)
		? value
		: null;

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
	sourceResourceInput?: unknown,
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
	const sourceResource = creationRel(
		sourceResourceInput ?? modelOneRel(sourceClip, "resource"),
	);
	const sourceText = creationRel(modelOneRel(sourceClip, "text"));
	const sourceEffects = modelRel(sourceClip, "effects");
	const effectRefs = Array.isArray(sourceEffects)
		? sourceEffects.filter((entry) => creationRel(entry))
		: [];
	return {
		reviewTrack: {
			attrs: {
				kind: mediaKind === "audio" ? "audio" : "video",
				name: `Incoming Review - ${sourceName ?? clipId}`,
				trackRole: "incomingReview",
				enabled: false,
				visibleInPreview: false,
				muted: true,
				locked: false,
				isVisible: true,
				height: 72,
			},
			rels: {
				project,
			},
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
			},
			rels: {
				resource: sourceResource ?? null,
				...(sourceText ? { text: sourceText } : null),
				effects: effectRefs,
			},
			hold_ref_id: "parkedIncomingClip",
		},
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
			clip: { use_ref_id: "parkedIncomingClip" },
			targetTrack: { use_ref_id: "incomingReviewTrack" },
			targetTrackRole: "incomingReview",
		},
	};
};

export const reduceAcceptParkedClipOnReviewTrack = (payload: unknown) => {
	if (!isRecord(payload)) {
		return payload;
	}
	const rels = isRecord(payload.rels) ? payload.rels : null;
	return {
		clip: payload.clip ?? rels?.clip,
		targetTrack: payload.targetTrack ?? rels?.targetTrack,
	};
};
