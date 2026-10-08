import path from "node:path";
import type { ProbeResult } from "../../media/contracts/probe";

export type ImportedMediaKind = "video" | "audio" | "image";

/** Timeline length of a still image; the web platforms give every imported image the same. */
export const STILL_IMAGE_DURATION_SECONDS = 1;

const IMAGE_FORMAT = /(_pipe$|^image2$|^png$|^apng$|^webp$|^bmp$|^tiff)/;

/** Resource kind of a probed file, or null when it has neither video nor audio. */
export const classifyProbe = (probe: ProbeResult): ImportedMediaKind | null => {
	if (probe.video) {
		const stillImage =
			IMAGE_FORMAT.test(probe.formatName) ||
			(probe.video.frameCount === 1 && probe.audio === null);
		return stillImage ? "image" : "video";
	}
	return probe.audio ? "audio" : null;
};

const MIME_BY_EXTENSION: Record<string, string> = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".flac": "audio/flac",
	".ogg": "audio/ogg",
	".opus": "audio/ogg",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp",
};

export const mimeForPath = (filePath: string): string =>
	MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ??
	"application/octet-stream";

/**
 * Technical metadata in the shape the model and the relink policy use
 * (`MediaTechnicalMetadata`), from a probe result.
 */
export const technicalMetadataFromProbe = (
	probe: ProbeResult,
	kind: ImportedMediaKind,
) => ({
	kind,
	duration: kind === "image" ? 0 : probe.durationSeconds,
	frameRate: probe.video?.fps ?? probe.video?.nominalFps ?? null,
	timebase: null,
	width: probe.video?.width ?? null,
	height: probe.video?.height ?? null,
	audioChannels: probe.audio?.channels ?? null,
	audioSampleRate: probe.audio?.sampleRate ?? null,
	streams: {
		videoStreams: kind === "video" ? 1 : 0,
		// ffprobe lists every stream: a video without audio is a known 0, not unknown.
		audioStreams:
			kind === "image" ? null : probe.streams.filter((stream) => stream.kind === "audio").length,
	},
});
