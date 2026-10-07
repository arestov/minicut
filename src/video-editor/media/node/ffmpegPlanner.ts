import type {
	SupportedPlanOperation,
	UnsupportedPlanOperation,
} from "../contracts/capabilities";
import type { MediaExportFormat } from "../contracts/export";
import { resolveExportRange } from "../../render/exportRange";
import type { ExportRange } from "../../render/exportTypes";
import {
	type ExportPlan,
	normalizeExportPlan,
} from "../../render/renderPlan";
import { normalizePreviewClipSource } from "../../read-model/previewComps";
import type { PreviewClipSource } from "../../read-model/previewComps";
import { MediaError } from "./mediaError";

/**
 * Pure planner: render plan -> ffmpeg arguments. No filesystem, no processes.
 *
 * Reference semantics are the browser renderer: clips are layered in plan
 * order (later clips on top) over black, video/image are fitted (contain) and
 * centred in the output frame, only audio-kind clips contribute sound, audio
 * gain is clamped to [0, 1.5] and pan uses the linear stereo law of
 * audioExportMixer. Frame count is max(1, ceil(duration * fps)).
 *
 * Media timestamps are normalised to the stream's first frame
 * (`setpts=PTS-STARTPTS`), so a clip's inPoint is relative to the media start
 * regardless of container start-time offsets.
 */

export const SUPPORTED_PLAN_OPERATIONS: SupportedPlanOperation[] = [
	"range",
	"clip-sequence",
	"trim",
	"output-fps",
	"output-size",
	"audio-gain",
	"audio-pan",
	"audio-mix",
];

export const UNSUPPORTED_PLAN_OPERATIONS: UnsupportedPlanOperation[] = [
	"text",
	"effect",
	"transform",
	"opacity",
	"fade",
];

export const AUDIO_SAMPLE_RATE = 48_000;

/**
 * Canvas background of the browser export (exportRenderer default #09090b), so
 * gaps and letterboxing are the same near-black instead of pure black.
 */
const EXPORT_BACKGROUND = "0x09090b";

/**
 * Output colour description of the browser export (WebCodecs tags its VP8/VP9
 * as limited range BT.601). The filter graph already yields BT.601 limited
 * data (the background and overlay convert to it); tag the stream so players
 * do not have to guess the matrix.
 */
const OUTPUT_COLOR_TAGS = [
	"-color_range",
	"tv",
	"-colorspace",
	"smpte170m",
	"-color_primaries",
	"smpte170m",
	"-color_trc",
	"smpte170m",
];

interface FfmpegPlanInputBase {
	plan: ExportPlan;
	range: ExportRange;
	/** Resolved file path by clip resourceId. */
	assetPaths: Record<string, string>;
	fps?: number;
	width?: number;
	height?: number;
	/**
	 * Channel count of each audio resource (from probe). Mono sources are
	 * duplicated to both channels at full level like the browser mixer
	 * (ffmpeg's own mono->stereo upmix would attenuate by 3 dB). Unknown
	 * resources are treated as stereo.
	 */
	audioChannels?: Record<string, number>;
	/**
	 * Resources probed to have no audio stream (e.g. a silent video's
	 * "Embedded audio" clip). Their audio clips contribute silence, like the
	 * browser mixer which skips a source without an audio track.
	 */
	silentAudioResources?: readonly string[];
}

export interface FfmpegExportPlanInput extends FfmpegPlanInputBase {
	format: MediaExportFormat;
	/** Where ffmpeg writes (the runner passes a temp path). */
	outputPath: string;
	preview?: undefined;
}

/**
 * Preview mode: plan a raw RGBA stream on stdout for the window
 * [start, start + duration) of the timeline, without audio and progress
 * output. Video inputs are seeked with an input `-ss` instead of decoding
 * from the file start. The picture semantics (layering, trim, fit) are the
 * export ones.
 */
export interface FfmpegPreviewPlanInput extends FfmpegPlanInputBase {
	preview: { start: number; duration: number };
	/**
	 * Frame rate of each video resource (from probe). With it the preview
	 * selects the same source frame as export `trim`, which keeps the first
	 * source frame at or after the in-point and times the following frames
	 * from it, even when the in-point is not on the source frame grid. Without
	 * it the preview seeks to the exact in-point (may differ by a source frame
	 * for sub-frame in-points).
	 */
	sourceFps?: Record<string, number>;
	format?: undefined;
	outputPath?: undefined;
}

export type FfmpegPlanInput = FfmpegExportPlanInput | FfmpegPreviewPlanInput;

/** Input seek margin (seconds) kept before the first wanted source frame. */
const PREVIEW_SEEK_PAD = 0.5;

/**
 * How far before a preview slot source frames are kept so the fps filter can
 * repeat the last one across a gap of a variable-frame-rate source, as export does.
 */
const PREVIEW_LOOK_BEHIND = 0.4;

export interface FfmpegPlan {
	args: string[];
	durationSeconds: number;
	frameCount: number;
	fps: number;
	width: number;
	height: number;
	hasAudio: boolean;
	clipIds: string[];
}

interface UnsupportedFinding {
	clipId: string;
	operation: UnsupportedPlanOperation;
}

const EPSILON = 1e-6;

const fmt = (value: number): string => {
	const text = value.toFixed(6);
	return text.replace(/\.?0+$/, "") || "0";
};

const isPositiveFinite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

const hasScalarAnimation = (scalar: {
	value: number;
	keyframes?: unknown[];
}): boolean => Boolean(scalar.keyframes && scalar.keyframes.length > 0);

const findUnsupported = (clip: PreviewClipSource): UnsupportedFinding[] => {
	const findings: UnsupportedFinding[] = [];
	const add = (operation: UnsupportedPlanOperation): void => {
		findings.push({ clipId: clip.id, operation });
	};
	if (clip.resourceKind === "text" || clip.text) {
		add("text");
		return findings;
	}
	if (clip.resourceKind === "audio") {
		// Audio-clip fades, effects and opacity are ignored on purpose: the browser
		// audioExportMixer only honours gain and pan. If the web starts honouring
		// them, report them here as unsupported-operation instead of dropping them.
		return findings;
	}
	if (clip.effects.some((effect) => effect.enabled !== false)) add("effect");
	const { x, y, scale, rotation } = clip.transform;
	const identity =
		!hasScalarAnimation(x) &&
		!hasScalarAnimation(y) &&
		!hasScalarAnimation(scale) &&
		!hasScalarAnimation(rotation) &&
		x.value === 0 &&
		y.value === 0 &&
		scale.value === 1 &&
		rotation.value === 0;
	if (!identity) add("transform");
	if (hasScalarAnimation(clip.opacity) || clip.opacity.value !== 1) {
		add("opacity");
	}
	if (clip.fadeIn > 0 || clip.fadeOut > 0) add("fade");
	return findings;
};

const stereoPanGains = (gain: number, pan: number): [number, number] => {
	const p = Math.max(-1, Math.min(1, pan));
	return [gain * (p <= 0 ? 1 : 1 - p), gain * (p >= 0 ? 1 : 1 + p)];
};

interface RangedClip {
	clip: PreviewClipSource;
	/** Start on the output timeline (seconds). */
	outStart: number;
	duration: number;
	/** Source offset (seconds, relative to media start). */
	sourceStart: number;
}

const clipToRange = (
	clip: PreviewClipSource,
	rangeStart: number,
	rangeEnd: number,
): RangedClip | null => {
	const clipEnd = clip.start + clip.duration;
	const start = Math.max(clip.start, rangeStart);
	const end = Math.min(clipEnd, rangeEnd);
	if (end - start <= EPSILON) return null;
	return {
		clip,
		outStart: start - rangeStart,
		duration: end - start,
		sourceStart: clip.inPoint + (start - clip.start),
	};
};

const encoderArgs = (format: MediaExportFormat, hasAudio: boolean): string[] => {
	if (format === "mp4") {
		return [
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			...OUTPUT_COLOR_TAGS,
			...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
			"-movflags",
			"+faststart",
			"-f",
			"mp4",
		];
	}
	return [
		"-c:v",
		"libvpx-vp9",
		"-b:v",
		"0",
		"-crf",
		"32",
		"-row-mt",
		"1",
		"-deadline",
		"good",
		"-cpu-used",
		"5",
		"-pix_fmt",
		"yuv420p",
		...OUTPUT_COLOR_TAGS,
		...(hasAudio ? ["-c:a", "libopus", "-b:a", "128k"] : []),
		"-f",
		"webm",
	];
};

/**
 * Export keeps the first source frame at or after the in-point (f0), times
 * every later frame from it, rounds those times to the output frame grid (fps
 * filter) and shifts them by `clip.start / TB`, which truncates to a whole
 * slot. The frame shown in output slot s of the clip is therefore the one with
 * round((frame - f0) * fps) == s - floor(clip.start * fps). The preview
 * reproduces that for a window starting at slot `windowSlot`: it seeks near
 * the first wanted source frame (with one output frame of look-behind) and
 * keeps the same arithmetic relative to f0.
 */
const previewSeekFor = (
	clip: PreviewClipSource,
	windowSlot: number,
	outFps: number,
	duration: number,
	sourceFps: Record<string, number> | undefined,
): { target: number; trimStart: number; trimEnd: number; shift: number } | null => {
	const fps = sourceFps?.[clip.resourceId ?? clip.id];
	if (!isPositiveFinite(fps)) return null;
	const f0 = Math.ceil(clip.inPoint * fps - EPSILON) / fps;
	const clipSlot = Math.trunc(Number(fmt(clip.start)) / (1 / outFps));
	// Output slots of the clip already passed before the window starts.
	const skipped = Math.max(0, windowSlot - clipSlot);
	const origin = f0 + skipped / outFps;
	const first = skipped > 0 ? Math.max(f0, origin - PREVIEW_LOOK_BEHIND) : f0;
	const target = Math.max(0, first - PREVIEW_SEEK_PAD);
	return {
		target,
		trimStart: first - target,
		trimEnd: origin + duration - target,
		shift: origin - target,
	};
};

export const planFfmpegExport = (input: FfmpegPlanInput): FfmpegPlan => {
	if (!input.preview && input.format !== "webm" && input.format !== "mp4") {
		throw new MediaError(
			"unsupported-format",
			`Unsupported export format: ${String(input.format)}`,
			{ format: input.format },
		);
	}
	if (!input.preview && !input.outputPath) {
		throw new MediaError("invalid-request", "Export requires an outputPath");
	}
	const plan = normalizeExportPlan(input.plan);
	const fps = input.fps ?? (isPositiveFinite(plan.fps) ? plan.fps : 30);
	const width = input.width ?? (isPositiveFinite(plan.width) ? plan.width : 1280);
	const height =
		input.height ?? (isPositiveFinite(plan.height) ? plan.height : 720);
	if (!isPositiveFinite(fps) || fps > 240) {
		throw new MediaError("invalid-request", `Invalid fps: ${fps}`);
	}
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 2 ||
		height < 2 ||
		width % 2 !== 0 ||
		height % 2 !== 0
	) {
		throw new MediaError(
			"invalid-request",
			`Output size must be even integers, got ${width}x${height}`,
			{ width, height },
		);
	}

	let resolved: ReturnType<typeof resolveExportRange>;
	try {
		resolved = resolveExportRange(plan, input.range);
	} catch (error) {
		throw new MediaError(
			"invalid-request",
			error instanceof Error ? error.message : "Invalid export range",
		);
	}
	if (input.preview) {
		resolved = { ...resolved, ...input.preview };
	}
	const rangeStart = resolved.start;
	const rangeEnd = resolved.start + resolved.duration;
	if (!isPositiveFinite(resolved.duration)) {
		throw new MediaError("invalid-request", "Export range has no duration");
	}

	const selected = plan.clipSources
		.map((source) => normalizePreviewClipSource(source))
		.filter((source): source is PreviewClipSource => source !== null)
		.filter((source) => !resolved.clipIds || resolved.clipIds.has(source.id))
		.map((source) => clipToRange(source, rangeStart, rangeEnd))
		.filter((ranged): ranged is RangedClip => ranged !== null);

	const findings = selected.flatMap((ranged) => findUnsupported(ranged.clip));
	if (findings.length > 0) {
		const operations = [...new Set(findings.map((f) => f.operation))];
		throw new MediaError(
			"unsupported-operation",
			`FFmpeg export does not support: ${operations.join(", ")}`,
			{ operations, findings },
		);
	}

	const visual = selected.filter((r) => r.clip.resourceKind !== "audio");
	const silent = new Set(input.silentAudioResources ?? []);
	const audio = input.preview
		? []
		: selected.filter(
				(r) =>
					r.clip.resourceKind === "audio" &&
					!silent.has(r.clip.resourceId ?? r.clip.id),
			);

	const durationSeconds = resolved.duration;
	const frameCount = Math.max(1, Math.ceil(durationSeconds * fps));
	const outputDuration = frameCount / fps;

	const inputArgs: string[] = [];
	const filters: string[] = [];
	let inputIndex = 0;
	const assetPathFor = (clip: PreviewClipSource): string => {
		const key = clip.resourceId ?? clip.id;
		const found = input.assetPaths[key];
		if (!found) {
			throw new MediaError(
				"asset-not-found",
				`No file location for resource ${key} (clip ${clip.id})`,
				{ resourceId: key, clipId: clip.id },
			);
		}
		return found;
	};

	filters.push(
		`color=c=${EXPORT_BACKGROUND}:s=${width}x${height}:r=${fmt(fps)}:d=${fmt(outputDuration)},format=yuv420p[base]`,
	);
	let current = "base";
	visual.forEach((ranged, index) => {
		const { clip, outStart, duration, sourceStart } = ranged;
		const label = `v${index}`;
		const isImage = clip.resourceKind === "image";
		const path = assetPathFor(clip);
		const previewSeek = !isImage && input.preview
			? previewSeekFor(
					clip,
					Math.round(rangeStart * fps),
					fps,
					duration,
					input.sourceFps,
				)
			: null;
		if (isImage) {
			inputArgs.push(
				"-loop",
				"1",
				"-framerate",
				fmt(fps),
				"-t",
				fmt(duration),
				"-i",
				path,
			);
		} else if (input.preview) {
			inputArgs.push("-ss", fmt(previewSeek?.target ?? sourceStart), "-i", path);
		} else {
			inputArgs.push("-i", path);
		}
		const n = inputIndex;
		inputIndex += 1;
		const chain = [
			// A grid-aware preview keeps the seek-relative timestamps (no
			// normalisation to the first decoded frame) so the trim below sees
			// the same sub-frame offsets as export.
			...(previewSeek ? [] : ["setpts=PTS-STARTPTS"]),
			...(isImage
				? []
				: previewSeek
					? [
							`trim=start=${fmt(previewSeek.trimStart)}:end=${fmt(previewSeek.trimEnd)}`,
							`setpts=PTS-${fmt(previewSeek.shift)}/TB`,
						]
					: [
							`trim=start=${input.preview ? "0" : fmt(sourceStart)}:duration=${fmt(duration)}`,
							"setpts=PTS-STARTPTS",
						]),
			`fps=${fmt(fps)}${previewSeek ? ":start_time=0" : ""}`,
			`scale=${width}:${height}:force_original_aspect_ratio=decrease`,
			"setsar=1",
			"format=yuv420p",
			`setpts=PTS+${fmt(outStart)}/TB`,
		];
		filters.push(`[${n}:v]${chain.join(",")}[${label}]`);
		const next = `o${index}`;
		filters.push(
			`[${current}][${label}]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='between(t,${fmt(outStart)},${fmt(outStart + duration)})'[${next}]`,
		);
		current = next;
	});
	filters.push(`[${current}]null[vout]`);

	const hasAudio = audio.length > 0;
	if (hasAudio) {
		const labels: string[] = [];
		audio.forEach((ranged, index) => {
			const { clip, outStart, duration, sourceStart } = ranged;
			inputArgs.push("-i", assetPathFor(clip));
			const n = inputIndex;
			inputIndex += 1;
			const gain = Math.max(0, Math.min(1.5, Number(clip.audio.gain ?? 1)));
			const pan = Math.max(-1, Math.min(1, Number(clip.audio.pan ?? 0)));
			const [left, right] = stereoPanGains(gain, pan);
			const delayMs = Math.round(outStart * 1000);
			const mono = input.audioChannels?.[clip.resourceId ?? clip.id] === 1;
			const chain = [
				"asetpts=PTS-STARTPTS",
				`atrim=start=${fmt(sourceStart)}:duration=${fmt(duration)}`,
				"asetpts=PTS-STARTPTS",
				`aresample=${AUDIO_SAMPLE_RATE}`,
				...(mono
					? [
							"aformat=sample_fmts=fltp:channel_layouts=mono",
							`pan=stereo|c0=${fmt(left)}*c0|c1=${fmt(right)}*c0`,
						]
					: [
							"aformat=sample_fmts=fltp:channel_layouts=stereo",
							`pan=stereo|c0=${fmt(left)}*c0|c1=${fmt(right)}*c1`,
						]),
				...(delayMs > 0 ? [`adelay=${delayMs}:all=1`] : []),
			];
			const label = `a${index}`;
			filters.push(`[${n}:a]${chain.join(",")}[${label}]`);
			labels.push(label);
		});
		const mixInput =
			labels.length === 1
				? `[${labels[0]}]`
				: `${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,`;
		const tail = `apad=whole_dur=${fmt(outputDuration)},atrim=duration=${fmt(outputDuration)}`;
		filters.push(`${mixInput}${tail}[aout]`);
	}

	const args = [
		"-hide_banner",
		"-nostdin",
		"-y",
		"-loglevel",
		"error",
		"-nostats",
		...(input.preview ? [] : ["-progress", "pipe:1"]),
		...inputArgs,
		"-filter_complex",
		filters.join(";"),
		"-map",
		"[vout]",
		...(hasAudio ? ["-map", "[aout]"] : []),
		"-frames:v",
		String(frameCount),
		"-r",
		fmt(fps),
		...(input.preview
			? ["-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"]
			: [
					...encoderArgs(input.format, hasAudio),
					input.outputPath,
				]),
	];

	return {
		args,
		durationSeconds: outputDuration,
		frameCount,
		fps,
		width,
		height,
		hasAudio,
		clipIds: selected.map((r) => r.clip.id),
	};
};
