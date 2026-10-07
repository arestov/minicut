import { type FileHandle, open } from "node:fs/promises";
import { MediaError } from "../mediaError";
import { createPcmBuffer } from "./pcmBuffer";
import {
	PCM_BYTES_PER_FRAME,
	PCM_SAMPLE_RATE,
	type PcmSource,
} from "./pcmSource";

/** How much of the file is valid right now (the cache renders it while playback may already read). */
export type PcmFileExtent = {
	/** Frames written so far. */
	writtenFrames(): number;
	/** True when no more frames will be appended. */
	complete(): boolean;
	/** Registers a callback for appended frames or completion. Returns unsubscribe. */
	subscribe(listener: () => void): () => void;
};

export type FilePcmSourceOptions = {
	path: string;
	/** First frame to deliver. */
	startFrame: number;
	extent: PcmFileExtent;
	/** Read ahead up to this many frames. Default 1 s. */
	highWaterFrames?: number;
	/** Refill when buffered drops below this. Default 0.5 s. */
	lowWaterFrames?: number;
	/** Largest single read. Default 0.25 s. */
	readFrames?: number;
};

/**
 * Pull source over a raw f32 stereo file that may still be growing. The first
 * read starts immediately, so after `open` the first chunk is a disk read
 * away (a few ms), independent of how far into the timeline the start is.
 */
export const createFilePcmSource = (options: FilePcmSourceOptions): PcmSource => {
	const highWater = options.highWaterFrames ?? PCM_SAMPLE_RATE;
	const lowWater = options.lowWaterFrames ?? PCM_SAMPLE_RATE / 2;
	const maxRead = options.readFrames ?? PCM_SAMPLE_RATE / 4;
	const buffer = createPcmBuffer();
	let position = Math.max(0, Math.floor(options.startFrame));
	let handle: FileHandle | null = null;
	let pumping = false;
	let done = false;
	let cancelled = false;
	let failure: Error | null = null;
	let waiters: Array<{ frames: number; resolve: () => void }> = [];

	const settleWaiters = (): void => {
		const remaining: typeof waiters = [];
		for (const waiter of waiters) {
			if (done || cancelled || failure || buffer.frames >= waiter.frames) waiter.resolve();
			else remaining.push(waiter);
		}
		waiters = remaining;
	};

	const closeHandle = async (): Promise<void> => {
		const opened = handle;
		handle = null;
		await opened?.close().catch(() => undefined);
	};

	const hasWork = (): boolean =>
		!cancelled &&
		!done &&
		!failure &&
		highWater - buffer.frames > 0 &&
		(options.extent.writtenFrames() > position || options.extent.complete());

	const pump = async (): Promise<void> => {
		if (pumping) return;
		pumping = true;
		try {
			while (hasWork()) {
				const available = options.extent.writtenFrames() - position;
				if (available <= 0) {
					// complete() with nothing left to read
					done = true;
					break;
				}
				const count = Math.min(maxRead, available, highWater - buffer.frames);
				if (!handle) {
					const opened = await open(options.path, "r");
					if (cancelled) {
						await opened.close().catch(() => undefined);
						break;
					}
					handle = opened;
				}
				const bytes = Buffer.allocUnsafe(count * PCM_BYTES_PER_FRAME);
				const { bytesRead } = await handle.read(
					bytes,
					0,
					bytes.length,
					position * PCM_BYTES_PER_FRAME,
				);
				if (cancelled) break;
				const frames = Math.floor(bytesRead / PCM_BYTES_PER_FRAME);
				if (frames === 0) {
					throw new MediaError(
						"output-failed",
						"Audio cache file is shorter than its extent",
						{ path: options.path },
					);
				}
				buffer.push(bytes.subarray(0, frames * PCM_BYTES_PER_FRAME));
				position += frames;
				settleWaiters();
			}
		} catch (error) {
			failure =
				error instanceof Error ? error : new Error(String(error));
		} finally {
			pumping = false;
		}
		if (done || failure) await closeHandle();
		settleWaiters();
		// A write that landed while the loop was finishing must not be missed.
		if (hasWork()) void pump();
	};

	const unsubscribe = options.extent.subscribe(() => void pump());
	void pump();

	const refillIfLow = (): void => {
		if (buffer.frames < lowWater) void pump();
	};

	return {
		get bufferedFrames() {
			return buffer.frames;
		},
		get ended() {
			return (done || cancelled || failure !== null) && buffer.frames === 0;
		},
		get error() {
			return failure;
		},
		pull(count) {
			if (cancelled || count <= 0) return null;
			const available = buffer.frames;
			let out: Float32Array | null = null;
			if (available >= count) out = buffer.take(count);
			else if (done && available > 0) out = buffer.take(available);
			refillIfLow();
			return out;
		},
		skip(count) {
			if (cancelled || count <= 0) return 0;
			const dropped = Math.min(count, buffer.frames);
			if (dropped > 0) buffer.take(dropped);
			refillIfLow();
			return dropped;
		},
		ready: (count) =>
			new Promise<void>((resolve) => {
				waiters.push({ frames: count, resolve });
				settleWaiters();
			}),
		async cancel() {
			if (cancelled) return;
			cancelled = true;
			unsubscribe();
			buffer.clear();
			settleWaiters();
			await closeHandle();
		},
	};
};
