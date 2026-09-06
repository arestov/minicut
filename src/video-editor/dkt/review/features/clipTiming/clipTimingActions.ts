import {
	makeCrdtResolveBatchPayload,
} from "../../crdtReviewCommands";
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

const readReviewItemAttr = (item: unknown, key: string): unknown => {
	if (!isRecord(item)) {
		return undefined;
	}
	const states = item.states;
	if (isRecord(states) && states[key] !== undefined) {
		return states[key];
	}
	return item[key];
};

const reviewItemConflictGroupId = (item: unknown): string | null => {
	const source = readReviewItemAttr(item, "source");
	return isRecord(source) ? stringOrNull(source.conflictGroupId) : null;
};

const reviewItemAffectsClip = (item: unknown, clipId: string): boolean => {
	const affectedObjects = readReviewItemAttr(item, "affectedObjects");
	return Array.isArray(affectedObjects) &&
		affectedObjects.some(
			(object) =>
				isRecord(object) &&
				object.type === "clip" &&
				object.id === clipId,
		);
};

const matchingReviewDecisionInputs = ({
	conflictId,
	reviewItemId,
	conflictGroupId,
	clipId,
	action,
	domainResult,
	reviewItems,
}: {
	conflictId: string;
	reviewItemId: string;
	conflictGroupId: string | null;
	clipId: string;
	action: string;
	domainResult: unknown;
	reviewItems?: unknown;
}) => {
	const items = Array.isArray(reviewItems) ? reviewItems : [];
	const matches = items.filter((item) => {
		if (
			readReviewItemAttr(item, "status") !== "open" ||
			readReviewItemAttr(item, "kind") !== "clip_timing"
		) {
			return false;
		}
		if (conflictGroupId) {
			return reviewItemConflictGroupId(item) === conflictGroupId;
		}
		return reviewItemAffectsClip(item, clipId);
	});
	const inputs = matches.flatMap((item) => {
		const itemConflictId = stringOrNull(readReviewItemAttr(item, "conflictId"));
		const itemReviewItemId = stringOrNull(readReviewItemAttr(item, "reviewItemId"));
		return itemConflictId && itemReviewItemId
			? [{
					conflictId: itemConflictId,
					reviewItemId: itemReviewItemId,
					action,
					domainResult,
				}]
			: [];
	});
	return inputs.length > 0
		? inputs
		: [{ conflictId, reviewItemId, action, domainResult }];
};

export const reduceParkIncomingVariantOnReviewTrack = (
	payload: unknown,
	noop: unknown,
	project: unknown,
	sourceClip?: unknown,
	sourceResourceInput?: unknown,
	reviewItems?: unknown,
) => {
	if (!isRecord(payload)) {
		return noop;
	}
	const conflictId = stringOrNull(payload.conflictId);
	const reviewItemId = stringOrNull(payload.reviewItemId);
	const clipId = stringOrNull(payload.clipId) ?? getNodeId(sourceClip);
	const sourceClipId = getNodeId(sourceClip);
	const sourceTiming = parseClipTimingVariant(payload.sourceTiming);
	const parkedTiming = parseClipTimingVariant(payload.parkedTiming);
	if (
		!conflictId ||
		!reviewItemId ||
		!clipId ||
		(sourceClipId !== null && sourceClipId !== clipId) ||
		!sourceTiming ||
		!parkedTiming ||
		sourceTiming.start < 0 ||
		sourceTiming.in < 0 ||
		sourceTiming.duration <= 0 ||
		sourceTiming.fadeIn < 0 ||
		sourceTiming.fadeOut < 0 ||
		sourceTiming.fadeIn + sourceTiming.fadeOut > sourceTiming.duration ||
		parkedTiming.start < 0 ||
		parkedTiming.in < 0 ||
		parkedTiming.duration <= 0 ||
		parkedTiming.fadeIn < 0 ||
		parkedTiming.fadeOut < 0 ||
		parkedTiming.fadeIn + parkedTiming.fadeOut > parkedTiming.duration
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
	return reduceCreateParkedIncomingVariant({
		clipId,
		projectId: getNodeId(project),
		conflictId,
		reviewItemId,
		sourceTiming,
		reviewTrackAttrs: {
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
		project,
		parkedClipAttrs: {
			name: `${sourceName ?? "Clip"} incoming timing`,
			color: stringOrNull(modelAttr(sourceClip, "color")) ?? "#f59e0b",
			mediaKind: mediaKind ?? "video",
			start: parkedTiming.start,
			in: parkedTiming.in,
			duration: parkedTiming.duration,
			fadeIn: parkedTiming.fadeIn,
			fadeOut: parkedTiming.fadeOut,
			audio: objectAttr(sourceClip, "audio", { gain: 1, pan: 0 }),
			opacity: objectAttr(sourceClip, "opacity", { value: 1 }),
			transform: objectAttr(sourceClip, "transform", {
				x: { value: 0 },
				y: { value: 0 },
				scale: { value: 1 },
				rotation: { value: 0 },
			}),
		},
		parkedClipRels: {
			resource: sourceResource ?? null,
			...(sourceText ? { text: sourceText } : null),
			effects: effectRefs,
		},
		reviewItems,
	}, noop);
};

export const reduceCreateParkedIncomingVariant = (
	payload: unknown,
	noop: unknown,
) => {
	if (!isRecord(payload)) {
		return noop;
	}
	const conflictId = stringOrNull(payload.conflictId);
	const reviewItemId = stringOrNull(payload.reviewItemId);
	const conflictGroupId = stringOrNull(payload.conflictGroupId);
	const clipId = stringOrNull(payload.clipId);
	if (
		!conflictId ||
		!reviewItemId ||
		!clipId ||
		!isRecord(payload.sourceTiming) ||
		!isRecord(payload.reviewTrackAttrs) ||
		!isRecord(payload.parkedClipAttrs)
	) {
		return noop;
	}
	const sourceTiming = parseClipTimingVariant(payload.sourceTiming);
	if (!sourceTiming) {
		return noop;
	}
	const domainResult = {
		type: "parked_variant",
		parkedClipId: { use_ref_id: "parkedIncomingClip" },
		reviewTrackId: { use_ref_id: "incomingReviewTrack" },
		sourceClipId: clipId,
		variant: "incoming",
		sourceTiming,
	};
	const decisions = matchingReviewDecisionInputs({
		conflictId,
		reviewItemId,
		conflictGroupId,
		clipId,
		action: "parkIncomingVariantOnReviewTrack",
		domainResult,
		reviewItems: payload.reviewItems,
	});
	return {
		sourceClip: {
			[clipId]: {
				attrs: sourceTiming,
			},
		},
		reviewTrack: {
			attrs: payload.reviewTrackAttrs,
			rels: {
				project: payload.project,
			},
			hold_ref_id: "incomingReviewTrack",
		},
		parkedClip: {
			attrs: payload.parkedClipAttrs,
			rels: isRecord(payload.parkedClipRels) ? payload.parkedClipRels : {},
			hold_ref_id: "parkedIncomingClip",
		},
		crdtResolve: makeCrdtResolveBatchPayload(decisions),
		next: {
			clipId,
			projectId: payload.projectId,
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
