export interface ProxyArgsInput {
	inputPath: string;
	outputPath: string;
	/** Output height; width follows aspect ratio (even). Default 540. */
	height?: number;
	/** Every frame is a keyframe (best scrubbing). */
	allIntra?: boolean;
	/** Keyframe interval when not all-intra. Default 12. */
	gopSize?: number;
	hasAudio: boolean;
	/** Drop the audio track even when the source has one (scrub proxies). */
	videoOnly?: boolean;
}

/** Pure: ffmpeg arguments for an H.264 preview proxy. */
export const buildProxyArgs = (input: ProxyArgsInput): string[] => {
	const height = input.height ?? 540;
	const withAudio = input.hasAudio && !input.videoOnly;
	const gop = input.allIntra ? 1 : (input.gopSize ?? 12);
	return [
		"-hide_banner",
		"-nostdin",
		"-y",
		"-loglevel",
		"error",
		"-nostats",
		"-progress",
		"pipe:1",
		"-i",
		input.inputPath,
		"-map",
		"0:v:0",
		...(withAudio ? ["-map", "0:a:0"] : []),
		"-vf",
		`scale=-2:'min(${height},ih)'`,
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-crf",
		"23",
		"-pix_fmt",
		"yuv420p",
		"-g",
		String(gop),
		"-keyint_min",
		String(gop),
		"-sc_threshold",
		"0",
		...(withAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
		"-movflags",
		"+faststart",
		"-f",
		"mp4",
		input.outputPath,
	];
};
