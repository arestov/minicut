import { type ChildProcess, spawn } from "node:child_process";
import { MediaError } from "./mediaError";
import { killProcessTree } from "./processRunner";

export interface FfmpegRunHandle {
	/** Kill the process tree; the promise settles after the process exited. */
	cancel(): Promise<void>;
	/** Resolves on exit 0; rejects with a typed MediaError otherwise. */
	readonly finished: Promise<void>;
	readonly cancelled: boolean;
	readonly pid: number | undefined;
}

export interface FfmpegRunOptions {
	ffmpegPath: string;
	args: string[];
	/** Used to turn out_time into a 0..1 ratio. */
	totalSeconds: number;
	onProgress?: (ratio: number) => void;
	/** Hard upper bound for the process lifetime. */
	timeoutMs?: number;
}

/** Parse one `-progress` line; returns elapsed output seconds or null. */
export const parseProgressLine = (line: string): number | null => {
	const match = /^out_time_(?:us|ms)=(-?\d+)$/.exec(line.trim());
	if (!match) return null;
	// Both out_time_us and (misnamed) out_time_ms are microseconds in ffmpeg.
	const micro = Number(match[1]);
	return Number.isFinite(micro) && micro >= 0 ? micro / 1_000_000 : null;
};

const STDERR_LIMIT = 16 * 1024;

export const startFfmpeg = (options: FfmpegRunOptions): FfmpegRunHandle => {
	let child: ChildProcess;
	let cancelled = false;
	let exited = false;
	let exitWaiters: Array<() => void> = [];

	const finished = new Promise<void>((resolve, reject) => {
		let stderr = "";
		let stdoutBuffer = "";
		let lastRatio = -1;
		let timedOut = false;
		child = spawn(options.ffmpegPath, options.args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const timer = options.timeoutMs
			? setTimeout(() => {
					timedOut = true;
					void killProcessTree(child);
				}, options.timeoutMs)
			: null;

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdoutBuffer += chunk;
			let newline = stdoutBuffer.indexOf("\n");
			while (newline >= 0) {
				const line = stdoutBuffer.slice(0, newline);
				stdoutBuffer = stdoutBuffer.slice(newline + 1);
				const seconds = parseProgressLine(line);
				if (seconds !== null && options.totalSeconds > 0) {
					// Never report 1 from progress: completion is reported by the job.
					const ratio = Math.min(0.99, seconds / options.totalSeconds);
					if (ratio > lastRatio) {
						lastRatio = ratio;
						options.onProgress?.(ratio);
					}
				}
				newline = stdoutBuffer.indexOf("\n");
			}
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-STDERR_LIMIT);
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			if (timer) clearTimeout(timer);
			exited = true;
			for (const wake of exitWaiters) wake();
			exitWaiters = [];
			reject(
				error.code === "ENOENT"
					? new MediaError(
							"binary-not-found",
							`Binary not found: ${options.ffmpegPath}`,
							{ command: options.ffmpegPath },
						)
					: new MediaError("process-failed", error.message),
			);
		});
		child.on("close", (exitCode, signal) => {
			if (timer) clearTimeout(timer);
			exited = true;
			for (const wake of exitWaiters) wake();
			exitWaiters = [];
			if (cancelled) {
				reject(new MediaError("cancelled", "ffmpeg cancelled"));
			} else if (timedOut) {
				reject(
					new MediaError("process-timeout", "ffmpeg exceeded its time limit", {
						timeoutMs: options.timeoutMs,
					}),
				);
			} else if (exitCode === 0) {
				resolve();
			} else {
				reject(
					new MediaError("process-failed", "ffmpeg exited with an error", {
						exitCode,
						signal,
						stderr: stderr.trim(),
					}),
				);
			}
		});
	});
	// Callers always attach handlers; avoid unhandled rejection if they cancel first.
	finished.catch(() => undefined);

	return {
		finished,
		get cancelled() {
			return cancelled;
		},
		get pid() {
			return child.pid;
		},
		cancel: async () => {
			cancelled = true;
			if (exited) return;
			const done = new Promise<void>((resolve) => exitWaiters.push(resolve));
			await killProcessTree(child);
			await done;
		},
	};
};
