import type { MediaExportFormat } from "./export";

export type SupportedPlanOperation =
	| "range"
	| "clip-sequence"
	| "trim"
	| "output-fps"
	| "output-size"
	| "audio-gain"
	| "audio-pan"
	| "audio-mix";

export type UnsupportedPlanOperation =
	| "text"
	| "effect"
	| "transform"
	| "opacity"
	| "fade";

export interface MediaCapabilities {
	ffmpegVersion: string;
	formats: MediaExportFormat[];
	videoCodecs: string[];
	audioCodecs: string[];
	supportedPlanOperations: SupportedPlanOperation[];
	unsupportedPlanOperations: UnsupportedPlanOperation[];
	maxConcurrentJobs: number;
}
