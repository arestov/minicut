import { type ChildProcess, spawn } from "node:child_process";
import { MediaError } from "../mediaError";
import { killProcessTree } from "../processRunner";
import { createPcmBuffer } from "./pcmBuffer";
import { PCM_SAMPLE_RATE, type PcmSource } from "./pcmSource";

export type FfmpegPcmSourceOptions = {
	ffmpegPath: string;
	args: string[];
	/** Stop reading the process above this many buffered frames. Default 1 s. */
	highWaterFrames?: number;
	/** Resume reading below this many buffered frames. Default 0.5 s. */
	lowWaterFrames?: number;
	/** Diagnostics hook: called with the pid of the spawned process. */
	onProcessStart?: (pid: number) => void;
};

export type FfmpegPcmSource = PcmSource & {
	/** Process id, for diagnostics and leak checks. */
	readonly pid: number | undefined;
	/** Resolves when the process exited and its pipes closed. */
	readonly closed: Promise<void>;
	/** Resolves when `frames` are buffered, or the stream ended/failed first. */
	ready(frames: number): Promise<void>;
};

const STDERR_LIMIT = 16 * 1024;

/**
 * Runs an ffmpeg command that writes interleaved f32le stereo 48 kHz to
 * stdout and exposes it as a pull source. The pipe is paused above the high
 * water mark, so ffmpeg blocks on a full pipe and decodes only as fast as the
 * consumer pulls (backpressure by demand).
 */
export const createFfmpegPcmSource = (
	options: FfmpegPcmSourceOptions,
): FfmpegPcmSource => {
	const highWater = options.highWaterFrames ?? PCM_SAMPLE_RATE;
	const lowWater = options.lowWaterFrames ?? PCM_SAMPLE_RATE / 2;
	const buffer = createPcmBuffer();
	let producerDone = false;
	let cancelled = false;
	let failure: Error | null = null;
	let stderr = "";
	let resolveClosed: () => void = () => undefined;
	const closed = new Promise<void>((resolve) => {
		resolveClosed = resolve;
	});

	const child: ChildProcess = spawn(options.ffmpegPath, options.args, {
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (child.pid !== undefined) options.onProcessStart?.(child.pid);

	let waiters: Array<{ frames: number; resolve: () => void }> = [];
	const settleWaiters = (): void => {
		const available = buffer.frames;
		const remaining: typeof waiters = [];
		for (const waiter of waiters) {
			if (producerDone || cancelled || available >= waiter.frames) waiter.resolve();
			else remaining.push(waiter);
		}
		waiters = remaining;
	};

	const stdout = child.stdout;
	const frames = (): number => buffer.frames;
	const updateFlow = (): void => {
		if (!stdout || producerDone) return;
		if (frames() >= highWater) stdout.pause();
		else if (frames() <= lowWater) stdout.resume();
	};

	stdout?.on("data", (chunk: Buffer) => {
		if (cancelled) return;
		buffer.push(chunk);
		updateFlow();
		settleWaiters();
	});
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (text: string) => {
		stderr = (stderr + text).slice(-STDERR_LIMIT);
	});
	child.on("error", (error: NodeJS.ErrnoException) => {
		producerDone = true;
		failure =
			error.code === "ENOENT"
				? new MediaError(
						"binary-not-found",
						`Binary not found: ${options.ffmpegPath}`,
						{ command: options.ffmpegPath },
					)
				: new MediaError("process-failed", error.message);
		resolveClosed();
		settleWaiters();
	});
	child.on("close", (exitCode, signal) => {
		producerDone = true;
		if (!cancelled && !failure && exitCode !== 0) {
			failure = new MediaError("process-failed", "ffmpeg exited with an error", {
				exitCode,
				signal,
				stderr: stderr.trim(),
			});
		}
		resolveClosed();
		settleWaiters();
	});

	const take = (count: number): Float32Array => {
		const out = buffer.take(count);
		updateFlow();
		return out;
	};

	return {
		get pid() {
			return child.pid;
		},
		closed,
		ready: (count) =>
			new Promise<void>((resolve) => {
				waiters.push({ frames: count, resolve });
				settleWaiters();
			}),
		get bufferedFrames() {
			return frames();
		},
		get ended() {
			return producerDone && frames() === 0;
		},
		get error() {
			return failure;
		},
		pull(count) {
			if (cancelled || count <= 0) return null;
			const available = frames();
			if (available >= count) return take(count);
			if (producerDone && available > 0) return take(available);
			return null;
		},
		skip(count) {
			if (cancelled || count <= 0) return 0;
			const dropped = Math.min(count, frames());
			if (dropped > 0) take(dropped);
			return dropped;
		},
		async cancel() {
			if (cancelled) {
				await closed;
				return;
			}
			cancelled = true;
			buffer.clear();
			settleWaiters();
			await killProcessTree(child);
			await closed;
		},
	};
};
