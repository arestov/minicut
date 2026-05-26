import type {
	ClipFrameOperation,
	EditframeClip,
	ExportPlan,
} from "./renderPlan";

export type ExportFormat = "json-manifest" | "video-webm";

export type ExportRange =
	| { type: "project" }
	| { type: "clip"; clipId: string };

export interface ExportRenderRequest {
	plan: ExportPlan;
	range: ExportRange;
	format?: ExportFormat;
	fps?: number;
}

export interface ExportProgressEvent {
	stage: "queued" | "rendering" | "finalizing" | "done";
	progress: number;
}

export interface ExportFrameSample {
	index: number;
	time: number;
	operations: ClipFrameOperation[];
}

export type ExportBackend = "manifest" | "webcodecs" | "media-recorder";

export interface ExportDiagnostics {
	backend: ExportBackend;
	fallbackReason?: string;
	resolvedClipIds: string[];
	resolvedClipTypes: Array<EditframeClip["type"]>;
	audioClipCount: number;
}

export interface ExportManifest {
	format: ExportFormat;
	projectId: string;
	range: ExportRange;
	start: number;
	duration: number;
	fps: number;
	frameCount: number;
	clips: EditframeClip[];
	frames: ExportFrameSample[];
	diagnostics?: ExportDiagnostics;
}

export interface ExportRenderResult {
	id: string;
	fileName: string;
	mimeType: string;
	blob: Blob;
	size: number;
	duration: number;
	frameCount: number;
	manifest: ExportManifest;
	downloadUrl?: string;
	diagnostics?: ExportDiagnostics;
}

export interface ExportRenderer {
	render(
		request: ExportRenderRequest,
		onProgress?: (event: ExportProgressEvent) => void,
	): Promise<ExportRenderResult>;
}
