import type { AssetLocation } from "./assets";

export interface ProbeRequest {
	requestId: string;
	/** Either a direct location or an asset id resolved by the AssetResolver. */
	source: { assetId: string } | AssetLocation;
}

export interface ProbeVideoStream {
	kind: "video";
	index: number;
	codec: string;
	width: number;
	height: number;
	/** Average frame rate (frames / duration); null when unknown. */
	fps: number | null;
	/** Nominal/base stream rate reported by the container; null when unknown. */
	nominalFps: number | null;
	/** True when frame timing is variable (VFR). */
	variableFrameRate: boolean;
	durationSeconds: number | null;
	frameCount: number | null;
	startTimeSeconds: number;
	rotation: number;
}

export interface ProbeAudioStream {
	kind: "audio";
	index: number;
	codec: string;
	sampleRate: number;
	channels: number;
	durationSeconds: number | null;
	startTimeSeconds: number;
}

export interface ProbeOtherStream {
	kind: "other";
	index: number;
	codec: string;
}

export type ProbeStream = ProbeVideoStream | ProbeAudioStream | ProbeOtherStream;

export interface ProbeResult {
	requestId: string;
	path: string;
	formatName: string;
	durationSeconds: number;
	/** Container start time offset. */
	startTimeSeconds: number;
	sizeBytes: number;
	streams: ProbeStream[];
	video: ProbeVideoStream | null;
	audio: ProbeAudioStream | null;
}
