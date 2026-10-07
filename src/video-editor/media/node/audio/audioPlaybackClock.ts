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
	/** Shared latency estimate; default: a private one over the context. */
	latency?: OutputLatencyEstimator;
	/** Smoothing factor for the audio-vs-system offset, 0..1. Default 0.05. */
	smoothing?: number;
	/** Offset error above which the estimate snaps to the audio clock. Default 40 ms. */
	resyncThresholdMs?: number;
};

export type OutputLatencyEstimator = {
	/** Reads the context latency once and returns the current estimate (seconds). */
	sample(): number;
	/** Current estimate without reading the context. */
	value(): number;
};

/**
 * `AudioContext.outputLatency` is a hint that jumps (12.8 ms, 2 ms, 0 within
 * minutes on WASAPI); the median of the last readings is stable enough to
 * place audio on the cursor. Both the clock and the audio sink use one
 * estimator so they agree on what "audible now" means.
 */
export const createOutputLatencyEstimator = (
	ctx: Pick<AudioClockSource, "outputLatency">,
	windowSize = 31,
): OutputLatencyEstimator => {
	const readings: number[] = [];
	let estimate = Math.max(0, ctx.outputLatency ?? 0);
	return {
		sample() {
			readings.push(Math.max(0, ctx.outputLatency ?? 0));
			if (readings.length > windowSize) readings.shift();
			const sorted = [...readings].sort((a, b) => a - b);
			estimate = sorted[Math.floor(sorted.length / 2)] ?? 0;
			return estimate;
		},
		value: () => estimate,
	};
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

	const latency = options.latency ?? createOutputLatencyEstimator(ctx);

	const audioMs = (): number =>
		(ctx.currentTime - (compensate ? latency.sample() : 0)) * 1000;

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
