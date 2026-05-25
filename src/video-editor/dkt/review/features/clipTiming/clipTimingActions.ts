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

export const reduceParkIncomingVariantOnReviewTrack = (
	payload: unknown,
	noop: unknown,
	project: unknown,
) => {
	if (!isRecord(payload)) {
		return noop;
	}
	const conflictId = stringOrNull(payload.conflictId);
	const reviewItemId = stringOrNull(payload.reviewItemId);
	const clipId = stringOrNull(payload.clipId) ?? stringOrNull(payload.sourceClipId);
	const timing = parseClipTimingVariant(payload.timing);
	if (!conflictId || !reviewItemId || !clipId || !timing) {
		return noop;
	}
	return {
		reviewTrack: {
			attrs: {
				kind: "video",
				name: "Incoming Review",
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
				name: "Incoming timing variant",
				color: "#f59e0b",
				mediaKind: "video",
				start: timing.start,
				in: timing.in,
				duration: timing.duration,
				fadeIn: timing.fadeIn,
				fadeOut: timing.fadeOut,
				audio: { gain: 1, pan: 0 },
				opacity: { value: 1 },
				transform: {
					x: { value: 0 },
					y: { value: 0 },
					scale: { value: 1 },
					rotation: { value: 0 },
				},
			},
			rels: {
				track: { use_ref_id: "incomingReviewTrack" },
				project,
				resource: null,
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
