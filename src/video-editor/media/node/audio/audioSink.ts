import { PCM_CHANNELS, PCM_SAMPLE_RATE, type PcmSource } from "./pcmSource";

/** Structural subset of an AudioParam the sink drives. */
export type SinkAudioParam = {
	value: number;
	cancelScheduledValues(time: number): unknown;
	setValueAtTime(value: number, time: number): unknown;
	linearRampToValueAtTime(value: number, time: number): unknown;
};

export type SinkAudioNode = {
	connect(destination: unknown): unknown;
	disconnect(): void;
};

export type SinkGainNode = SinkAudioNode & { readonly gain: SinkAudioParam };

export type SinkBufferSource = SinkAudioNode & {
	buffer: unknown;
	start(when?: number): void;
	stop(when?: number): void;
};

export type SinkAudioBuffer = {
	copyToChannel(source: Float32Array, channel: number): void;
};

/** Structural subset of `AudioContext` / `OfflineAudioContext` (node-web-audio-api and browsers fit). */
export type AudioSinkContext = {
	readonly currentTime: number;
	readonly sampleRate: number;
	readonly outputLatency?: number;
	readonly destination: unknown;
	createGain(): SinkGainNode;
	createBuffer(
		channels: number,
		length: number,
		sampleRate: number,
	): SinkAudioBuffer;
	createBufferSource(): SinkBufferSource;
};

export type AudioSinkTimers = {
	/** Runs `callback` every `ms` until `cancelRepeat`. */
	repeat(callback: () => void, ms: number): unknown;
	cancelRepeat(handle: unknown): void;
	/** Runs `callback` once after `ms`. */
	after(callback: () => void, ms: number): unknown;
};

export type AudioSinkOptions = {
	context: AudioSinkContext;
	/** Chunk length in frames. Default 960 (20 ms at 48 kHz). */
	chunkFrames?: number;
	/** How far ahead of the device clock chunks are scheduled. Default 0.1 s. */
	lookaheadSeconds?: number;
	/** Gap between `play` and the first scheduled sample. Default 0.02 s. */
	startLeadSeconds?: number;
	/** Minimum distance between now and a chunk start; later chunks are realigned. Default 0.005 s. */
	minLeadSeconds?: number;
	/** Gain ramp when stopping, so a cut never clicks. Default 0.005 s. */
	rampSeconds?: number;
	/** Interval of the scheduling loop. Default 5 ms. */
	pumpIntervalMs?: number;
	/** Subtract `outputLatency` like the audio clock does. Default true. */
	compensateOutputLatency?: boolean;
	/** Output latency estimate in seconds; default: the context's raw `outputLatency`. */
	latencySeconds?(): number;
	timers?: AudioSinkTimers;
};

export type AudioSinkPlayRequest = {
	/** Timeline cursor that is audible when playback starts. */
	cursorSeconds: number;
	/**
	 * Opens the PCM stream for the timeline window starting at
	 * `streamStartSeconds` (cursor + start lead + output latency, so the first
	 * scheduled sample is the one the cursor reaches when it is heard).
	 */
	open(streamStartSeconds: number): PcmSource;
	/** Called once when the stream ran out of data (not after `stop`). */
	onEnded?(): void;
	/** Called once when the stream failed. */
	onError?(error: Error): void;
};

export type AudioSinkStats = {
	/** Chunks handed to the device clock since creation. */
	scheduledChunks: number;
	/** Pump passes that found the next chunk behind the device clock. */
	lateEvents: number;
	/** Frames dropped from the stream to realign it with the device clock. */
	skippedFrames: number;
	/** Plays started since creation. */
	plays: number;
};

export interface AudioSink {
	/** Starts (or restarts) playback; a running play is ramped out first. */
	play(request: AudioSinkPlayRequest): void;
	/** Ramps out and stops. Idempotent. */
	stop(): void;
	readonly playing: boolean;
	/** Master volume of the whole timeline mix (0..1.5). */
	setMasterGain(value: number): void;
	stats(): AudioSinkStats;
	/** Stops and releases the master gain node. The context belongs to the caller. */
	dispose(): void;
}

type ScheduledSource = { node: SinkBufferSource; endTime: number };

type ActivePlay = {
	source: PcmSource;
	gain: SinkGainNode;
	request: AudioSinkPlayRequest;
	/** Position of the next chunk on the device clock, in frames. */
	nextFrame: number;
	scheduled: ScheduledSource[];
	timer: unknown;
};

const defaultTimers: AudioSinkTimers = {
	repeat: (callback, ms) => globalThis.setInterval(callback, ms),
	cancelRepeat: (handle) =>
		globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
	after: (callback, ms) => globalThis.setTimeout(callback, ms),
};

/**
 * Audio output of the desktop app: schedules interleaved PCM as
 * `AudioBufferSourceNode` chunks on one `AudioContext` clock, 100 ms ahead,
 * through a per-play gain (stop/seek ramp) and a master gain (volume applies
 * immediately, not after the lookahead). Chunk starts sit on the sample grid,
 * so joins have no gaps or overlaps. Data that arrives late is dropped from
 * the head of the stream instead of delaying it: the stream position always
 * equals the device clock, which is what lets the audio clock drive the cursor.
 * Everything the executor needs arrives in the play request; the sink never
 * reads model state.
 */
export const createAudioSink = (options: AudioSinkOptions): AudioSink => {
	const ctx = options.context;
	const sampleRate = ctx.sampleRate;
	if (sampleRate !== PCM_SAMPLE_RATE) {
		throw new Error(
			`Audio sink needs a ${PCM_SAMPLE_RATE} Hz context, got ${sampleRate} Hz`,
		);
	}
	const chunkFrames = options.chunkFrames ?? 960;
	const lookahead = options.lookaheadSeconds ?? 0.1;
	const startLead = options.startLeadSeconds ?? 0.02;
	const minLead = options.minLeadSeconds ?? 0.005;
	const ramp = options.rampSeconds ?? 0.005;
	const pumpMs = options.pumpIntervalMs ?? 5;
	const compensate = options.compensateOutputLatency ?? true;
	const timers = options.timers ?? defaultTimers;

	const master = ctx.createGain();
	master.connect(ctx.destination);
	const counters: AudioSinkStats = {
		scheduledChunks: 0,
		lateEvents: 0,
		skippedFrames: 0,
		plays: 0,
	};
	let active: ActivePlay | null = null;
	let disposed = false;

	const releaseLater = (play: ActivePlay): void => {
		const now = ctx.currentTime;
		play.gain.gain.cancelScheduledValues(now);
		play.gain.gain.setValueAtTime(play.gain.gain.value, now);
		play.gain.gain.linearRampToValueAtTime(0, now + ramp);
		// Sources stay scheduled until the ramp ended, then everything goes.
		timers.after(
			() => {
				for (const item of play.scheduled) {
					try {
						item.node.stop();
					} catch {
						// already ended
					}
					item.node.disconnect();
				}
				play.scheduled.length = 0;
				play.gain.disconnect();
			},
			Math.ceil(ramp * 1000) + 20,
		);
	};

	const endPlay = (play: ActivePlay, ramped: boolean): void => {
		timers.cancelRepeat(play.timer);
		void play.source.cancel();
		if (ramped) releaseLater(play);
	};

	const deinterleave = (frames: Float32Array): SinkAudioBuffer => {
		const length = frames.length / PCM_CHANNELS;
		const left = new Float32Array(length);
		const right = new Float32Array(length);
		for (let i = 0; i < length; i += 1) {
			left[i] = frames[2 * i] as number;
			right[i] = frames[2 * i + 1] as number;
		}
		const buffer = ctx.createBuffer(PCM_CHANNELS, length, sampleRate);
		buffer.copyToChannel(left, 0);
		buffer.copyToChannel(right, 1);
		return buffer;
	};

	const pump = (play: ActivePlay): void => {
		if (active !== play) return;
		const { source } = play;
		const now = ctx.currentTime;
		play.scheduled = play.scheduled.filter((item) => item.endTime > now);
		if (source.error) {
			active = null;
			endPlay(play, true);
			play.request.onError?.(source.error);
			return;
		}
		for (;;) {
			const nextAt = play.nextFrame / sampleRate;
			if (nextAt - now >= lookahead) return;
			const earliest = now + minLead;
			if (nextAt < earliest) {
				// Behind the device clock: drop stream head so the position
				// stays equal to the clock, then wait for more data if needed.
				counters.lateEvents += 1;
				const wanted = Math.ceil((earliest - nextAt) * sampleRate);
				const dropped = source.skip(wanted);
				counters.skippedFrames += dropped;
				play.nextFrame += dropped;
				if (dropped < wanted) {
					if (source.ended) break;
					return;
				}
				continue;
			}
			const samples = source.pull(chunkFrames);
			if (!samples) {
				if (source.ended) break;
				return;
			}
			if (samples.length === 0) {
				if (source.ended) break;
				return;
			}
			const node = ctx.createBufferSource();
			node.buffer = deinterleave(samples);
			node.connect(play.gain);
			node.start(nextAt);
			const frames = samples.length / PCM_CHANNELS;
			play.scheduled.push({ node, endTime: nextAt + frames / sampleRate });
			counters.scheduledChunks += 1;
			play.nextFrame += frames;
			if (source.ended) break;
		}
		// Stream finished: everything is scheduled; stop the loop, ended fires
		// when the last chunk has been heard.
		timers.cancelRepeat(play.timer);
		const endsAt = play.nextFrame / sampleRate;
		const remainingMs = Math.max(0, (endsAt - ctx.currentTime) * 1000);
		timers.after(() => {
			if (active !== play) return;
			active = null;
			endPlay(play, false);
			play.gain.disconnect();
			play.request.onEnded?.();
		}, Math.ceil(remainingMs) + 10);
	};

	const latency = (): number =>
		compensate
			? Math.max(0, options.latencySeconds?.() ?? ctx.outputLatency ?? 0)
			: 0;

	return {
		play(request) {
			if (disposed) throw new Error("Audio sink is disposed");
			if (active) {
				const previous = active;
				active = null;
				endPlay(previous, true);
			}
			counters.plays += 1;
			const startAt = ctx.currentTime + startLead;
			const streamStart = Math.max(
				0,
				request.cursorSeconds + startLead + latency(),
			);
			const source = request.open(streamStart);
			const gain = ctx.createGain();
			gain.gain.setValueAtTime(1, ctx.currentTime);
			gain.connect(master);
			const play: ActivePlay = {
				source,
				gain,
				request,
				nextFrame: Math.round(startAt * sampleRate),
				scheduled: [],
				timer: null,
			};
			active = play;
			play.timer = timers.repeat(() => pump(play), pumpMs);
			pump(play);
		},
		stop() {
			if (!active) return;
			const previous = active;
			active = null;
			endPlay(previous, true);
		},
		get playing() {
			return active !== null;
		},
		setMasterGain(value) {
			const clamped = Math.max(0, Math.min(1.5, Number.isFinite(value) ? value : 1));
			master.gain.cancelScheduledValues(ctx.currentTime);
			master.gain.setValueAtTime(clamped, ctx.currentTime);
		},
		stats: () => ({ ...counters }),
		dispose() {
			if (disposed) return;
			disposed = true;
			if (active) {
				const previous = active;
				active = null;
				endPlay(previous, false);
				previous.gain.disconnect();
				for (const item of previous.scheduled) {
					try {
						item.node.stop();
					} catch {
						// already ended
					}
				}
			}
			master.disconnect();
		},
	};
};
