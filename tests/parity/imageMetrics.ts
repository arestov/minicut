import { runCaptured } from "../../src/video-editor/media/node/processRunner";

const FFMPEG = process.env.MINICUT_FFMPEG_PATH ?? "ffmpeg";

export type ImageBox = { x: number; y: number; width: number; height: number };
export type PictureRef = { file: string; box: ImageBox | null };

/**
 * Both pictures are cut to their picture box, shrunk by this fraction on every
 * side (the web stage draws a dashed outline along the edge of its safe area),
 * and averaged down to the comparison size.
 */
export const PICTURE_INSET = 0.02;

const picture = (input: number, ref: PictureRef, label: string, size: string): string => {
	const crop = ref.box
		? `crop=${Math.round(ref.box.width)}:${Math.round(ref.box.height)}:${Math.round(ref.box.x)}:${Math.round(ref.box.y)},`
		: "";
	const inset = `crop=iw*${1 - 2 * PICTURE_INSET}:ih*${1 - 2 * PICTURE_INSET}:iw*${PICTURE_INSET}:ih*${PICTURE_INSET}`;
	return `[${input}:v]${crop}${inset},scale=${size}:flags=area,format=yuv420p[${label}]`;
};

const runSsim = async (args: string[], graph: string): Promise<number> => {
	const result = await runCaptured(
		FFMPEG,
		["-hide_banner", "-nostdin", "-v", "info", ...args, "-filter_complex", graph, "-frames:v", "1", "-f", "null", "-"],
		{ timeoutMs: 60_000 },
	);
	if (result.exitCode !== 0) throw new Error(`ffmpeg ssim failed: ${result.stderr.slice(-600)}`);
	const match = /SSIM[^\n]*All:([\d.]+)/.exec(result.stderr);
	if (!match) throw new Error("SSIM metric not found in ffmpeg output");
	return Number(match[1]);
};

/** SSIM (0..1) of two PNG pictures of the same scene. Strict: a missing metric throws. */
export const imageSsim = (
	reference: PictureRef,
	test: PictureRef,
	size: { width: number; height: number } = { width: 320, height: 240 },
): Promise<number> => {
	const dimension = `${size.width}:${size.height}`;
	return runSsim(
		["-i", reference.file, "-i", test.file],
		`${picture(0, reference, "r", dimension)};${picture(1, test, "t", dimension)};[t][r]ssim`,
	);
};

/**
 * SSIM of a preview picture against the source frame at `at` seconds of
 * `video` (scaled to the comparison size). Used to tell which source frame a
 * platform shows: the score is highest for the frame the picture is made of.
 */
export const sourceFrameSsim = (
	pictureRef: PictureRef,
	video: string,
	at: number,
	size: { width: number; height: number } = { width: 320, height: 240 },
): Promise<number> => {
	const dimension = `${size.width}:${size.height}`;
	const inset = `crop=iw*${1 - 2 * PICTURE_INSET}:ih*${1 - 2 * PICTURE_INSET}:iw*${PICTURE_INSET}:ih*${PICTURE_INSET}`;
	return runSsim(
		["-i", pictureRef.file, "-ss", String(Math.max(0, at)), "-i", video],
		`${picture(0, pictureRef, "r", dimension)};[1:v]${inset},scale=${dimension}:flags=area,format=yuv420p[t];[t][r]ssim`,
	);
};

/** SSIM of a picture against a flat colour (hex like 09090b); about 1 for an empty frame. */
export const flatColorSsim = (
	pictureRef: PictureRef,
	hex: string,
	size: { width: number; height: number } = { width: 320, height: 240 },
): Promise<number> => {
	const dimension = `${size.width}:${size.height}`;
	return runSsim(
		["-i", pictureRef.file, "-f", "lavfi", "-i", `color=c=0x${hex}:s=${size.width}x${size.height}:r=1`],
		`${picture(0, pictureRef, "r", dimension)};[1:v]format=yuv420p[t];[t][r]ssim`,
	);
};
