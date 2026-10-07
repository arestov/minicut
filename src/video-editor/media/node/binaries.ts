export interface MediaBinaries {
	ffmpegPath: string;
	ffprobePath: string;
}

/** Binary paths: explicit option, then env, then PATH lookup by bare name. */
export const resolveMediaBinaries = (
	options: Partial<MediaBinaries> = {},
	env: NodeJS.ProcessEnv = process.env,
): MediaBinaries => ({
	ffmpegPath: options.ffmpegPath ?? env.MINICUT_FFMPEG_PATH ?? "ffmpeg",
	ffprobePath: options.ffprobePath ?? env.MINICUT_FFPROBE_PATH ?? "ffprobe",
});
