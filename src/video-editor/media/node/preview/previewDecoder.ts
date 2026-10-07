import { type ChildProcess, spawn } from "node:child_process";
import type { ExportPlan } from "../../../render/renderPlan";
import { normalizeExportPlan } from "../../../render/renderPlan";
import { planFfmpegExport } from "../ffmpegPlanner";
import { MediaError } from "../mediaError";
import { killProcessTree } from "../processRunner";
import { type FramePool, frameFromPoolBuffer } from "./framePool";
import type { ProducedPreviewFrame } from "./previewTypes";

/**
 * Cancellable preview decoding on top of the export planner: the same plan
 * semantics (layering over black, trim, fit) render raw RGBA frames to stdout.
 * One ffmpeg process per request; a seek is a new process with input `-ss`.
 */

const FRAME_EPSILON = 1e-6;
const STDERR_LIMIT = 8 * 1024;

export const planFps = (plan: ExportPlan, fps?: number): number => {
	const value = fps ?? normalizeExportPlan(plan).fps;
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: 30;
};

/** Index of the output frame whose slot contains `timeSeconds`. */
export const frameIndexAt = (timeSeconds: number, fps: number): number =>
	Math.max(0, Math.floor(timeSeconds * fps + FRAME_EPSILON));

export const frameTimeAt = (index: number, fps: number): number => index / fps;

export interface PreviewDecodeOptions {
	ffmpegPath: string;
	plan: ExportPlan;
	/** Resolved file path by clip resourceId. */
	assetPaths: Record<string, string>;
	/** Preview bitmap size in pixels; even integers. */
	width: number;
	height: number;
	fps?: number;
	/** Timeline time of the first frame (quantized down to a frame slot). */
	timeSeconds: number;
	/** Number of frames to decode; omitted = until the end of the plan. */
	frameCount?: number;
	generation: number;
	streamId: string;
	pool: FramePool;
	/** Called for every decoded frame; the callee owns it and must `release()`. */
	onFrame: (frame: ProducedPreviewFrame) => void;
}

export type PreviewDecodeOutcome =
	| { status: "done"; frames: number; dropped: number }
	| { status: "cancelled"; frames: number; dropped: number }
	| { status: "failed"; error: MediaError };

export interface PreviewDecodeHandle {
	/** Never rejects. */
	readonly outcome: Promise<PreviewDecodeOutcome>;
	readonly pid: number | undefined;
	/** Kills the process tree; settles after the process exited. */
	cancel(): Promise<void>;
}

const failed = (error: MediaError): PreviewDecodeHandle => ({
	outcome: Promise.resolve({ status: "failed", error }),
	pid: undefined,
	cancel: async () => undefined,
});

export const startPreviewDecode = (
	options: PreviewDecodeOptions,
): PreviewDecodeHandle => {
	const { width, height, pool } = options;
	const frameBytes = width * height * 4;
	if (pool.byteLength !== frameBytes) {
		return failed(
			new MediaError("invalid-request", "Pool buffer size does not match frame size", {
				poolByteLength: pool.byteLength,
				frameBytes,
			}),
		);
	}
	const fps = planFps(options.plan, options.fps);
	const firstIndex = frameIndexAt(options.timeSeconds, fps);
	const start = frameTimeAt(firstIndex, fps);
	const planDuration = normalizeExportPlan(options.plan).duration;
	const remaining = Math.max(1, Math.ceil((planDuration - start) * fps - FRAME_EPSILON));
	const frameCount = Math.max(1, options.frameCount ?? remaining);

	let args: string[];
	try {
		args = planFfmpegExport({
			plan: options.plan,
			range: { type: "project" },
			// Half a frame short of the end so float noise never adds a frame.
			preview: { start, duration: (frameCount - 0.5) / fps },
			assetPaths: options.assetPaths,
			fps,
			width,
			height,
		}).args;
	} catch (error) {
		return failed(
			error instanceof MediaError
				? error
				: new MediaError("process-failed", String(error)),
		);
	}

	let child: ChildProcess;
	let cancelled = false;
	let exited = false;
	let exitWaiters: Array<() => void> = [];
	let frames = 0;
	let dropped = 0;

	const outcome = new Promise<PreviewDecodeOutcome>((resolve) => {
		let stderr = "";
		let current: Uint8Array | null = null;
		let filled = 0;
		let skipping = false;
		let spawnError: MediaError | null = null;

		const finishFrame = (): void => {
			const sequence = frames;
			frames += 1;
			if (skipping || !current) {
				dropped += 1;
			} else {
				const pixels = current;
				options.onFrame(
					frameFromPoolBuffer(pool, pixels, {
						width,
						height,
						generation: options.generation,
						streamId: options.streamId,
						sequence,
						ptsSeconds: frameTimeAt(firstIndex + sequence, fps),
					}),
				);
			}
			current = null;
			filled = 0;
			skipping = false;
		};

		const onData = (chunk: Buffer): void => {
			if (cancelled) return;
			let offset = 0;
			while (offset < chunk.length) {
				if (filled === 0 && !skipping && !current) {
					current = pool.acquire();
					if (!current) skipping = true;
				}
				const take = Math.min(chunk.length - offset, frameBytes - filled);
				if (current) {
					current.set(chunk.subarray(offset, offset + take), filled);
				}
				filled += take;
				offset += take;
				if (filled === frameBytes) finishFrame();
			}
		};

		child = spawn(options.ffmpegPath, args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout?.on("data", onData);
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (text: string) => {
			stderr = (stderr + text).slice(-STDERR_LIMIT);
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			spawnError =
				error.code === "ENOENT"
					? new MediaError(
							"binary-not-found",
							`Binary not found: ${options.ffmpegPath}`,
							{ command: options.ffmpegPath },
						)
					: new MediaError("process-failed", error.message);
		});
		child.on("close", (exitCode, signal) => {
			exited = true;
			// A partially read frame is never delivered.
			if (current) pool.release(current);
			current = null;
			for (const wake of exitWaiters) wake();
			exitWaiters = [];
			if (cancelled) {
				resolve({ status: "cancelled", frames, dropped });
			} else if (spawnError) {
				resolve({ status: "failed", error: spawnError });
			} else if (exitCode === 0) {
				resolve({ status: "done", frames, dropped });
			} else {
				resolve({
					status: "failed",
					error: new MediaError("process-failed", "ffmpeg exited with an error", {
						exitCode,
						signal,
						stderr: stderr.trim(),
					}),
				});
			}
		});
	});

	return {
		outcome,
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

/**
 * Decodes exactly one frame at `timeSeconds`. `result` resolves null when the
 * decode was cancelled or the frame was dropped because the pool was
 * exhausted; `outcome` tells which (`dropped > 0`).
 */
export const decodePreviewFrame = (
	options: Omit<PreviewDecodeOptions, "frameCount" | "onFrame">,
): {
	result: Promise<ProducedPreviewFrame | null>;
	outcome: Promise<PreviewDecodeOutcome>;
	cancel: () => Promise<void>;
	readonly pid: number | undefined;
} => {
	let frame: ProducedPreviewFrame | null = null;
	const handle = startPreviewDecode({
		...options,
		frameCount: 1,
		onFrame: (decoded) => {
			frame = decoded;
		},
	});
	const result = handle.outcome.then((outcome) => {
		if (outcome.status === "failed") throw outcome.error;
		if (outcome.status === "cancelled") {
			(frame as ProducedPreviewFrame | null)?.release();
			return null;
		}
		return frame;
	});
	result.catch(() => undefined);
	return {
		result,
		outcome: handle.outcome,
		cancel: handle.cancel,
		get pid() {
			return handle.pid;
		},
	};
};
