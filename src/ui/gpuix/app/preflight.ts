import { mkdir } from "node:fs/promises";
import { resolveMediaBinaries } from "../../../video-editor/media/node/binaries";
import { runCaptured } from "../../../video-editor/media/node/processRunner";

export class StartupError extends Error {
	readonly hint: string;
	constructor(title: string, hint: string, cause?: unknown) {
		super(title, cause ? { cause } : undefined);
		this.name = "StartupError";
		this.hint = hint;
	}
}

const checkBinary = async (
	label: string,
	command: string,
	envName: string,
): Promise<void> => {
	try {
		const result = await runCaptured(command, ["-version"], { timeoutMs: 10_000 });
		if (result.exitCode !== 0) throw new Error(`exit code ${result.exitCode}`);
	} catch (error) {
		throw new StartupError(
			`${label} was not found or does not run (${command}).`,
			`Install FFmpeg and put ${label} on PATH, or set ${envName} to its full path.`,
			error,
		);
	}
};

/**
 * Checks everything the app needs before it opens a project: a writable
 * profile directory and the FFmpeg/ffprobe binaries. Failures are explicit
 * startup errors; nothing falls back to an empty or fake host.
 */
export const preflight = async (profileDir: string): Promise<void> => {
	try {
		await mkdir(profileDir, { recursive: true });
	} catch (error) {
		throw new StartupError(
			`The profile folder cannot be created: ${profileDir}`,
			"Set MINICUT_PROFILE_DIR to a folder you can write to.",
			error,
		);
	}
	const binaries = resolveMediaBinaries();
	await checkBinary("ffmpeg", binaries.ffmpegPath, "MINICUT_FFMPEG_PATH");
	await checkBinary("ffprobe", binaries.ffprobePath, "MINICUT_FFPROBE_PATH");
};
