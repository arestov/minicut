import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolveMediaBinaries } from "../binaries";
import { MediaError } from "../mediaError";
import { runCaptured } from "../processRunner";

/**
 * Reproducible media fixtures generated with ffmpeg at test time and cached
 * under a gitignored directory. Never commit generated media.
 */
export type FixtureName =
	| "video-cfr"
	| "video-audio"
	| "video-av-webm"
	| "video-two-tone-webm"
	| "video-blue-webm"
	| "video-red-bt709"
	| "video-vfr"
	| "video-vfr-webm"
	| "video-offset"
	| "audio-tone"
	| "image-card";

export interface FixtureSpec {
	file: string;
	/** ffmpeg arguments between `-y` and the output file. */
	args: string[];
}

/** Bump to invalidate caches when specs change. */
const FIXTURE_VERSION = "v1";

const LAVFI_VIDEO = "testsrc2=size=320x240:rate=25:duration=2";

export const FIXTURE_SPECS: Record<FixtureName, FixtureSpec> = {
	"video-cfr": {
		file: "video-cfr.mp4",
		args: [
			"-f",
			"lavfi",
			"-i",
			LAVFI_VIDEO,
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-g",
			"25",
		],
	},
	"video-audio": {
		file: "video-audio.mp4",
		args: [
			"-f",
			"lavfi",
			"-i",
			LAVFI_VIDEO,
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=2",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-ac",
			"2",
			"-shortest",
		],
	},
	// VP9/Opus WebM with audio: decodable by headless Chromium (no H.264/AAC).
	"video-av-webm": {
		file: "video-av.webm",
		args: [
			"-f",
			"lavfi",
			"-i",
			LAVFI_VIDEO,
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=2",
			"-c:v",
			"libvpx-vp9",
			"-pix_fmt",
			"yuv420p",
			"-g",
			"25",
			"-c:a",
			"libopus",
			"-ac",
			"2",
			"-shortest",
		],
	},
	"video-two-tone-webm": {
		file: "video-two-tone.webm",
		args: [
			"-f", "lavfi", "-i", LAVFI_VIDEO,
			"-f", "lavfi", "-i",
			"aevalsrc='0.08*sin(2*PI*if(lt(t,1),440,880)*t)':s=48000:d=2",
			"-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-g", "25",
			"-c:a", "libopus", "-ac", "2", "-shortest",
		],
	},
	// Solid-colour VP9 clips for layering checks (blue is layered over other clips).
	"video-blue-webm": {
		file: "video-blue.webm",
		args: [
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:size=320x240:rate=25:duration=2",
			"-c:v",
			"libvpx-vp9",
			"-pix_fmt",
			"yuv420p",
		],
	},
	// Saturated red encoded and tagged as limited-range BT.709.
	"video-red-bt709": {
		file: "video-red-bt709.mp4",
		args: [
			"-f",
			"lavfi",
			"-i",
			"color=c=red:size=320x240:rate=25:duration=2",
			"-vf",
			"scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
			"-c:v",
			"libx264",
			"-colorspace",
			"bt709",
			"-color_primaries",
			"bt709",
			"-color_trc",
			"bt709",
			"-color_range",
			"tv",
		],
	},
	// Irregular frame gaps with preserved timestamps -> variable frame rate.
	"video-vfr": {
		file: "video-vfr.mkv",
		args: [
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=320x240:rate=30:duration=3",
			"-vf",
			"select='lt(mod(n,7),4)'",
			"-fps_mode",
			"passthrough",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
		],
	},
	// The same irregular frame gaps in a WebM, decodable by headless Chromium.
	"video-vfr-webm": {
		file: "video-vfr.webm",
		args: [
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=320x240:rate=30:duration=3",
			"-vf",
			"select='lt(mod(n,7),4)'",
			"-fps_mode",
			"passthrough",
			"-c:v",
			"libvpx-vp9",
			"-pix_fmt",
			"yuv420p",
		],
	},
	// Container/stream start time of 1.5s.
	"video-offset": {
		file: "video-offset.mkv",
		args: [
			"-f",
			"lavfi",
			"-i",
			LAVFI_VIDEO,
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=330:sample_rate=48000:duration=2",
			"-vf",
			"setpts=PTS+1.5/TB",
			"-af",
			"asetpts=PTS+1.5/TB",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"libopus",
			"-fps_mode",
			"passthrough",
		],
	},
	"audio-tone": {
		file: "audio-tone.wav",
		args: [
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=880:sample_rate=44100:duration=3",
			"-ac",
			"1",
			"-c:a",
			"pcm_s16le",
		],
	},
	"image-card": {
		file: "image-card.png",
		args: [
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=160x120:rate=1:duration=1",
			"-frames:v",
			"1",
		],
	},
};

export interface FixtureOptions {
	ffmpegPath?: string;
	/** Defaults to MINICUT_MEDIA_FIXTURE_DIR or <cwd>/tmp/media-fixtures. */
	directory?: string;
}

export const resolveFixtureDirectory = (directory?: string): string =>
	path.resolve(
		directory ??
			process.env.MINICUT_MEDIA_FIXTURE_DIR ??
			path.join(process.cwd(), "tmp", "media-fixtures", FIXTURE_VERSION),
	);

const exists = async (file: string): Promise<boolean> => {
	try {
		return (await stat(file)).size > 0;
	} catch {
		return false;
	}
};

/** Generate (or reuse cached) fixture; returns its absolute path. */
export const ensureFixture = async (
	name: FixtureName,
	options: FixtureOptions = {},
): Promise<string> => {
	const directory = resolveFixtureDirectory(options.directory);
	const spec = FIXTURE_SPECS[name];
	const target = path.join(directory, spec.file);
	if (await exists(target)) return target;

	await mkdir(directory, { recursive: true });
	const { ffmpegPath } = resolveMediaBinaries({
		ffmpegPath: options.ffmpegPath,
	});
	// Atomic: unique partial name keeps parallel test workers from clobbering.
	const partial = path.join(
		directory,
		`.${process.pid}-${spec.file}.part${path.extname(spec.file)}`,
	);
	const result = await runCaptured(
		ffmpegPath,
		["-hide_banner", "-loglevel", "error", "-y", ...spec.args, partial],
		{ timeoutMs: 60_000 },
	);
	if (result.exitCode !== 0) {
		await rm(partial, { force: true });
		throw new MediaError("process-failed", `Fixture ${name} failed`, {
			stderr: result.stderr.slice(0, 2000),
		});
	}
	try {
		await rename(partial, target);
	} catch (error) {
		// Another worker won the race; its file is equivalent.
		await rm(partial, { force: true });
		if (!(await exists(target))) throw error;
	}
	return target;
};

export const ensureFixtures = async (
	names: FixtureName[],
	options: FixtureOptions = {},
): Promise<Record<FixtureName, string>> => {
	const entries = await Promise.all(
		names.map(async (name) => [name, await ensureFixture(name, options)] as const),
	);
	return Object.fromEntries(entries) as Record<FixtureName, string>;
};
