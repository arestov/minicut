// SPIKE (stage 4-audio): prototype, not wired into any host yet.
import type { PlaybackClock } from "../../../playback/playbackRuntime";

/** Structural subset of `AudioContext` the clock needs (node-web-audio-api and browser both fit). */
export type AudioClockSource = {
	readonly currentTime: number;
	readonly outputLatency?: number;
	readonly state: string;
};

export type AudioPlaybackClockOptions = {
	/** System monotonic ms, used only to interpolate between audio clock updates. */
	systemMonotonicMs(): number;
	nowEpochMs(): number;
	requestFrame(callback: () => void): number;
	cancelFrame(frameId: number): void;
	/** Subtract `outputLatency` so the clock reports what is audible, not what was rendered. Default true. */
	compensateOutputLatency?: boolean;
	/** Smoothing factor for the audio-vs-system offset, 0..1. Default 0.05. */
	smoothing?: number;
	/** Offset error above which the estimate snaps to the audio clock. Default 40 ms. */
	resyncThresholdMs?: number;
};

/**
 * `PlaybackClock` whose monotonic time follows `AudioContext.currentTime`.
 * The audio clock advances in device-callback steps (jittery); between steps the clock interpolates
 * with the system clock and the offset to audio time is low-pass filtered. Output never goes
 * backwards and is frozen while the context is not running.
 */
export const createAudioPlaybackClock = (
	ctx: AudioClockSource,
	options: AudioPlaybackClockOptions,
): PlaybackClock => {
	const smoothing = options.smoothing ?? 0.05;
	const resyncThresholdMs = options.resyncThresholdMs ?? 40;
	const compensate = options.compensateOutputLatency ?? true;
	let offsetMs: number | null = null;
	let lastMs = 0;
	let wasRunning = true;

	const audioMs = (): number =>
		(ctx.currentTime - (compensate ? (ctx.outputLatency ?? 0) : 0)) * 1000;

	return {
		nowEpochMs: () => options.nowEpochMs(),
		nowMonotonicMs: () => {
			const running = ctx.state === "running";
			if (!running) {
				wasRunning = false;
				return lastMs;
			}
			const system = options.systemMonotonicMs();
			const audio = audioMs();
			const sample = audio - system;
			if (offsetMs === null || !wasRunning || Math.abs(sample - offsetMs) > resyncThresholdMs) {
				offsetMs = sample;
			} else {
				offsetMs += (sample - offsetMs) * smoothing;
			}
			wasRunning = true;
			lastMs = Math.max(lastMs, system + offsetMs);
			return lastMs;
		},
		requestFrame: (callback) => options.requestFrame(callback),
		cancelFrame: (frameId) => options.cancelFrame(frameId),
	};
};
