import type { ResourceKind } from "../domain/types";

export type MediaIdentityEvidence =
	| "same-entry"
	| "fingerprint-match"
	| "metadata-only"
	| "mismatch";

export type MediaStreamTopology = {
	videoStreams: number;
	audioStreams: number;
};

export type MediaTechnicalMetadata = {
	kind: ResourceKind;
	duration: number;
	frameRate?: number | null;
	timebase?: number | null;
	width?: number | null;
	height?: number | null;
	audioChannels?: number | null;
	audioSampleRate?: number | null;
	streams: MediaStreamTopology;
};

export type RelinkReasonCode =
	| "invalid-metadata"
	| "media-kind-mismatch"
	| "stream-topology-mismatch"
	| "source-range-too-short"
	| "duration-differs"
	| "frame-rate-differs"
	| "timebase-differs"
	| "dimensions-differ"
	| "audio-properties-differ"
	| "identity-not-proven"
	| "identity-mismatch";

export type RelinkCompatibility =
	| "exact-match"
	| "compatible-replacement"
	| "incompatible";

export type RelinkPolicyInput = {
	original: MediaTechnicalMetadata;
	candidate: MediaTechnicalMetadata;
	requiredSourceEnd: number;
	identity: MediaIdentityEvidence;
};

export type RelinkPolicyResult = {
	classification: RelinkCompatibility;
	reasons: RelinkReasonCode[];
	durationTolerance: number;
	requiresConfirmation: boolean;
};

const finiteNonNegative = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

const validOptionalPositive = (value: number | null | undefined): boolean =>
	value == null || (Number.isFinite(value) && value > 0);

const validMetadata = (metadata: MediaTechnicalMetadata): boolean =>
	finiteNonNegative(metadata.duration) &&
	validOptionalPositive(metadata.frameRate) &&
	validOptionalPositive(metadata.timebase) &&
	validOptionalPositive(metadata.width) &&
	validOptionalPositive(metadata.height) &&
	validOptionalPositive(metadata.audioChannels) &&
	validOptionalPositive(metadata.audioSampleRate) &&
	Number.isInteger(metadata.streams.videoStreams) &&
	metadata.streams.videoStreams >= 0 &&
	Number.isInteger(metadata.streams.audioStreams) &&
	metadata.streams.audioStreams >= 0;

/** At most two frames, falling back to a conservative 1/30 second. */
export const calculateDurationTolerance = (
	frameRate: number | null | undefined,
): number => {
	if (typeof frameRate !== "number" || !Number.isFinite(frameRate) || frameRate <= 0) {
		return 1 / 30;
	}
	return 2 / frameRate;
};

const differs = (
	left: number | null | undefined,
	right: number | null | undefined,
	tolerance = 0,
): boolean => left != null && right != null && Math.abs(left - right) > tolerance;

export const evaluateRelinkCandidate = (
	input: RelinkPolicyInput,
): RelinkPolicyResult => {
	const durationTolerance = calculateDurationTolerance(
		input.original.frameRate ?? input.candidate.frameRate,
	);
	if (
		!validMetadata(input.original) ||
		!validMetadata(input.candidate) ||
		!finiteNonNegative(input.requiredSourceEnd)
	) {
		return {
			classification: "incompatible",
			reasons: ["invalid-metadata"],
			durationTolerance,
			requiresConfirmation: false,
		};
	}

	const hardReasons: RelinkReasonCode[] = [];
	const warnings: RelinkReasonCode[] = [];
	if (input.original.kind !== input.candidate.kind) hardReasons.push("media-kind-mismatch");
	if (
		input.original.streams.videoStreams !== input.candidate.streams.videoStreams ||
		input.original.streams.audioStreams !== input.candidate.streams.audioStreams
	) hardReasons.push("stream-topology-mismatch");
	if (input.candidate.duration + durationTolerance < input.requiredSourceEnd) {
		hardReasons.push("source-range-too-short");
	}
	if (Math.abs(input.original.duration - input.candidate.duration) > durationTolerance) warnings.push("duration-differs");
	if (differs(input.original.frameRate, input.candidate.frameRate, 0.001)) warnings.push("frame-rate-differs");
	if (differs(input.original.timebase, input.candidate.timebase)) warnings.push("timebase-differs");
	if (differs(input.original.width, input.candidate.width) || differs(input.original.height, input.candidate.height)) warnings.push("dimensions-differ");
	if (differs(input.original.audioChannels, input.candidate.audioChannels) || differs(input.original.audioSampleRate, input.candidate.audioSampleRate)) warnings.push("audio-properties-differ");

	if (hardReasons.length > 0) {
		return { classification: "incompatible", reasons: hardReasons, durationTolerance, requiresConfirmation: false };
	}

	const exact = input.identity === "same-entry" || input.identity === "fingerprint-match";
	if (exact && warnings.length === 0) {
		return { classification: "exact-match", reasons: [], durationTolerance, requiresConfirmation: false };
	}
	return {
		classification: "compatible-replacement",
		reasons: [
			...warnings,
			input.identity === "mismatch" ? "identity-mismatch" : "identity-not-proven",
		],
		durationTolerance,
		requiresConfirmation: true,
	};
};
