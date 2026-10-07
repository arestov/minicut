import {
	createAudioPlaybackClock,
	createOutputLatencyEstimator,
} from "../../../video-editor/media/node/audio/audioPlaybackClock";
import {
	type AudioSink,
	type AudioSinkContext,
	createAudioSink,
} from "../../../video-editor/media/node/audio/audioSink";
import type { AudioClockSource } from "../../../video-editor/media/node/audio/audioPlaybackClock";
import type { PcmMixCache } from "../../../video-editor/media/node/audio/pcmMixCache";
import type { PcmSource } from "../../../video-editor/media/node/audio/pcmSource";
import type { AudioMixStreamRequest } from "../../../video-editor/media/contracts/audioStream";
import type { PlaybackClock } from "../../../video-editor/playback/playbackRuntime";
import type { AudioMixController } from "./audioMixController";

/** What the host needs of the output device context (a real `AudioContext` fits). */
export type DesktopAudioContext = AudioSinkContext &
	AudioClockSource & {
		onstatechange: ((event: unknown) => void) | null;
		close(): Promise<void>;
	};

/** Audio side of the playback executor. */
export type PlaybackAudio = {
	/**
	 * Clock for `PlaybackRuntime`: the audio clock while the device runs, the
	 * system clock while it is suspended or lost.
	 */
	readonly clock: PlaybackClock;
	/** Starts (or restarts) sound so that `cursorSeconds` is what is audible now. */
	start(cursorSeconds: number): void;
	stop(): void;
	/**
	 * `clock`: the device state changed and the clock switched source; `mix`:
	 * the timeline audio changed. Returns unsubscribe.
	 */
	subscribe(listener: (change: "clock" | "mix") => void): () => void;
	/** Applies the timeline volume (0..1.5). */
	setVolume(value: number): void;
	dispose(): Promise<void>;
};

export type DesktopAudioOptions = {
	context: DesktopAudioContext;
	mix: AudioMixController;
	/** Opens the PCM stream of the mix (media service). */
	openStream(request: AudioMixStreamRequest): PcmSource;
	/**
	 * Rendered mix: seeks read it instead of spawning a decoder. Without it,
	 * or while it is still rendering past the start, the stream is opened directly.
	 */
	cache?: PcmMixCache;
	/** Fallback clock used while the device is not running (system timers). */
	fallbackClock: PlaybackClock;
	systemMonotonicMs?(): number;
	onError?(error: Error): void;
};

/**
 * Composes the audio output for the desktop host: sink + audio clock on one
 * `AudioContext`, fed by the mix descriptor the host resolved for the plan.
 * The clock reports system time whenever the context is not running; the
 * executor re-anchors the run on that switch and restarts sound when the
 * device is back.
 */
export const createDesktopAudio = (options: DesktopAudioOptions): PlaybackAudio => {
	const { context, fallbackClock } = options;
	const systemMonotonicMs = options.systemMonotonicMs ?? (() => performance.now());
	const latency = createOutputLatencyEstimator(context);
	const sink: AudioSink = createAudioSink({
		context,
		latencySeconds: () => latency.value(),
	});
	const audioClock = createAudioPlaybackClock(context, {
		systemMonotonicMs,
		nowEpochMs: () => fallbackClock.nowEpochMs(),
		requestFrame: (callback) => fallbackClock.requestFrame(callback),
		cancelFrame: (frameId) => fallbackClock.cancelFrame(frameId),
		latency,
	});
	const listeners = new Set<(change: "clock" | "mix") => void>();
	const emit = (change: "clock" | "mix"): void => {
		for (const listener of [...listeners]) listener(change);
	};
	let active = context.state === "running";

	const clock: PlaybackClock = {
		nowEpochMs: () => fallbackClock.nowEpochMs(),
		nowMonotonicMs: () =>
			active ? audioClock.nowMonotonicMs() : fallbackClock.nowMonotonicMs(),
		requestFrame: (callback) => fallbackClock.requestFrame(callback),
		cancelFrame: (frameId) => fallbackClock.cancelFrame(frameId),
	};

	context.onstatechange = () => {
		const running = context.state === "running";
		if (running === active) return;
		active = running;
		if (!running) sink.stop();
		emit("clock");
	};
	const prepareCache = (): void => {
		const mix = options.mix.current();
		if (mix) options.cache?.prepare(mix);
	};
	prepareCache();
	const unsubscribeMix = options.mix.subscribe(() => {
		prepareCache();
		emit("mix");
	});

	return {
		clock,
		start(cursorSeconds) {
			const mix = options.mix.current();
			if (!active || !mix) {
				sink.stop();
				return;
			}
			sink.play({
				cursorSeconds,
				open: (startSeconds) =>
					options.cache?.open(mix, startSeconds) ??
					options.openStream({ ...mix, startSeconds }),
				onError: (error) => options.onError?.(error),
			});
		},
		stop: () => sink.stop(),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setVolume: (value) => sink.setMasterGain(value),
		async dispose() {
			unsubscribeMix();
			listeners.clear();
			context.onstatechange = null;
			sink.dispose();
			await options.cache?.dispose();
			await context.close().catch(() => undefined);
		},
	};
};
