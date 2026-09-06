import type { MediaTechnicalMetadata } from "./mediaRelinkPolicy";

type ProbeElement = HTMLVideoElement | HTMLAudioElement;
export type BrowserMediaProbePlatform = {
	createElement(kind: "video" | "audio"): ProbeElement;
	createObjectURL(file: File): string;
	revokeObjectURL(url: string): void;
};

const inferKind = (file: File): "video" | "audio" => file.type.startsWith("audio/") ? "audio" : "video";

export const probeBrowserMediaFile = async (
	file: File,
	signal?: AbortSignal,
	platform: BrowserMediaProbePlatform = {
		createElement: (kind) => document.createElement(kind),
		createObjectURL: (value) => URL.createObjectURL(value),
		revokeObjectURL: (url) => URL.revokeObjectURL(url),
	},
): Promise<MediaTechnicalMetadata> => {
	if (signal?.aborted) throw new DOMException("Probe cancelled", "AbortError");
	const kind = inferKind(file); const element = platform.createElement(kind); const url = platform.createObjectURL(file);
	try {
		await new Promise<void>((resolve, reject) => {
			const done = () => { cleanup(); resolve(); };
			const fail = () => { cleanup(); reject(new Error("Browser could not decode media metadata")); };
			const abort = () => { cleanup(); reject(new DOMException("Probe cancelled", "AbortError")); };
			const cleanup = () => { element.removeEventListener("loadedmetadata", done); element.removeEventListener("error", fail); signal?.removeEventListener("abort", abort); };
			element.addEventListener("loadedmetadata", done, { once: true }); element.addEventListener("error", fail, { once: true }); signal?.addEventListener("abort", abort, { once: true }); element.preload = "metadata"; element.src = url;
		});
		if (!Number.isFinite(element.duration) || element.duration < 0) throw new Error("Media duration is unavailable");
		const video = kind === "video" ? element as HTMLVideoElement : null;
		return { kind, duration: element.duration, frameRate: null, timebase: null, width: video?.videoWidth || null, height: video?.videoHeight || null, audioChannels: null, audioSampleRate: null, streams: { videoStreams: kind === "video" ? 1 : 0, audioStreams: kind === "audio" ? 1 : null } };
	} finally { element.removeAttribute("src"); element.load(); platform.revokeObjectURL(url); }
};
