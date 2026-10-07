import { spawn } from "node:child_process";
import { runCaptured } from "../processRunner";

/**
 * ffmpeg based measurements for tests and the Web-vs-Node differential check.
 * Parsing is intentionally strict: a missing metric throws instead of
 * returning NaN so a broken measurement can never pass a tolerance check.
 */

const FFMPEG = process.env.MINICUT_FFMPEG_PATH ?? "ffmpeg";

const runFfmpegStats = async (args: string[]): Promise<string> => {
	const result = await runCaptured(
		FFMPEG,
		["-hide_banner", "-nostdin", "-v", "info", ...args, "-f", "null", "-"],
		{ timeoutMs: 60_000 },
	);
	if (result.exitCode !== 0) {
		throw new Error(`ffmpeg metric failed: ${result.stderr.slice(-800)}`);
	}
	return result.stderr;
};

const need = (text: string, pattern: RegExp, what: string): number => {
	const match = pattern.exec(text);
	if (!match) throw new Error(`Metric not found: ${what}`);
	const value = Number(match[1]);
	if (!Number.isFinite(value)) {
		// psnr reports "inf" for identical frames
		if (/inf/i.test(match[1])) return Number.POSITIVE_INFINITY;
		throw new Error(`Metric not numeric: ${what}`);
	}
	return value;
};

export type FrameMetric = "psnr" | "ssim";

export interface FrameCompareOptions {
	/** Seconds into each file (relative to the first video frame). */
	at: number;
	metric: FrameMetric;
	/** Compare at this size (both inputs are scaled). Default 320x240. */
	width?: number;
	height?: number;
}

/** PSNR (dB) or SSIM (0..1) of one frame of `test` against `reference`. */
export const compareFrameAt = async (
	reference: string,
	test: string,
	options: FrameCompareOptions,
): Promise<number> => {
	const size = `${options.width ?? 320}:${options.height ?? 240}`;
	const filter = `[0:v]scale=${size},format=yuv420p[r];[1:v]scale=${size},format=yuv420p[t];[t][r]${options.metric}`;
	const stderr = await runFfmpegStats([
		"-ss",
		String(options.at),
		"-i",
		reference,
		"-ss",
		String(options.at),
		"-i",
		test,
		"-filter_complex",
		filter,
		"-frames:v",
		"1",
	]);
	return options.metric === "psnr"
		? need(stderr, /PSNR[^\n]*average:(inf|[\d.]+)/, "psnr")
		: need(stderr, /SSIM[^\n]*All:([\d.]+)/, "ssim");
};

/** Mean luma (0..255) of the frame at `at`, via a 1x1 gray scale. */
export const meanLumaAt = async (file: string, at: number): Promise<number> => {
	const result = await new Promise<Buffer>((resolve, reject) => {
		const child = spawn(
			FFMPEG,
			[
				"-hide_banner", "-v", "error", "-ss", String(at), "-i", file,
				"-frames:v", "1", "-vf", "scale=1:1:flags=area,format=gray",
				"-f", "rawvideo", "-",
			],
			{ windowsHide: true },
		);
		const chunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => chunks.push(c));
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve(Buffer.concat(chunks))
				: reject(new Error(`exit ${code}`)),
		);
	});
	if (result.length < 1) throw new Error("No frame decoded");
	return result[0];
};

export interface AudioStats {
	/** Overall RMS level in dBFS. */
	rmsDb: number;
	/** Overall peak level in dBFS. */
	peakDb: number;
}

export const audioStats = async (file: string): Promise<AudioStats> => {
	const stderr = await runFfmpegStats(["-i", file, "-vn", "-af", "astats=metadata=0:reset=0"]);
	const overall = stderr.slice(stderr.lastIndexOf("Overall"));
	return {
		rmsDb: need(overall, /RMS level dB:\s*(-?[\d.]+|-inf)/, "rms"),
		peakDb: need(overall, /Peak level dB:\s*(-?[\d.]+|-inf)/, "peak"),
	};
};

/** EBU R128 integrated loudness (LUFS). */
export const integratedLoudness = async (file: string): Promise<number> => {
	const stderr = await runFfmpegStats(["-i", file, "-vn", "-af", "ebur128=peak=none"]);
	const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
	return need(summary, /I:\s*(-?[\d.]+)\s*LUFS/, "integrated loudness");
};
