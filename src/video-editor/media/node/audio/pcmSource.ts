/** Sample rate of every PCM stream in the desktop audio path (matches the export mixer). */
export const PCM_SAMPLE_RATE = 48_000;
/** Channels of every PCM stream: interleaved stereo. */
export const PCM_CHANNELS = 2;
export const PCM_BYTES_PER_FRAME = PCM_CHANNELS * Float32Array.BYTES_PER_ELEMENT;

/**
 * Pull-based source of interleaved f32 stereo PCM at 48 kHz. Frame 0 is the
 * stream start the consumer asked for; consumers map frame index to time
 * themselves. Everything is synchronous so a scheduler can decide from what is
 * buffered right now; producers fill the buffer on their own and stop when it
 * is full (backpressure by consumer demand).
 */
export interface PcmSource {
	/** Frames available to `pull` / `skip` right now. */
	readonly bufferedFrames: number;
	/** True when nothing is buffered and nothing more will arrive. */
	readonly ended: boolean;
	/** Set when the producer failed; the stream then ends. */
	readonly error: Error | null;
	/**
	 * Exactly `frames` frames, or null when fewer are buffered. After the
	 * producer finished, the final remainder (fewer frames) is returned once.
	 */
	pull(frames: number): Float32Array | null;
	/** Drops up to `frames` buffered frames and returns how many were dropped. */
	skip(frames: number): number;
	/** Resolves when `frames` are buffered, or the stream ended, failed or was cancelled first. */
	ready(frames: number): Promise<void>;
	/** Stops the producer and releases its resources. Idempotent. */
	cancel(): Promise<void>;
}

/** A source that has ended already (no audio to play). */
export const createEmptyPcmSource = (): PcmSource => ({
	bufferedFrames: 0,
	ended: true,
	error: null,
	pull: () => null,
	skip: () => 0,
	ready: () => Promise.resolve(),
	cancel: () => Promise.resolve(),
});
