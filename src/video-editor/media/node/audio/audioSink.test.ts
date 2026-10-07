import { describe, expect, it } from "vitest";
import {
	type AudioSinkContext,
	type AudioSinkTimers,
	createAudioSink,
	type SinkBufferSource,
	type SinkGainNode,
} from "./audioSink";
import { PCM_SAMPLE_RATE, type PcmSource } from "./pcmSource";

type FakeGain = SinkGainNode & {
	connected: unknown;
	disconnected: boolean;
	ramps: Array<{ value: number; time: number }>;
};

type FakeSource = SinkBufferSource & {
	startedAt: number | null;
	stopped: boolean;
	left: Float32Array;
};

const makeContext = (outputLatency = 0) => {
	const state = { currentTime: 0 };
	const gains: FakeGain[] = [];
	const sources: FakeSource[] = [];
	const context: AudioSinkContext = {
		get currentTime() {
			return state.currentTime;
		},
		sampleRate: PCM_SAMPLE_RATE,
		outputLatency,
		destination: "destination",
		createGain() {
			const gain: FakeGain = {
				connected: null,
				disconnected: false,
				ramps: [],
				gain: {
					value: 1,
					cancelScheduledValues: () => undefined,
					setValueAtTime(value) {
						this.value = value;
					},
					linearRampToValueAtTime(value, time) {
						gain.ramps.push({ value, time });
					},
				},
				connect(destination) {
					gain.connected = destination;
				},
				disconnect() {
					gain.disconnected = true;
				},
			};
			gains.push(gain);
			return gain;
		},
		createBuffer(_channels, length) {
			const left = new Float32Array(length);
			const right = new Float32Array(length);
			return {
				copyToChannel(data: Float32Array, channel: number) {
					(channel === 0 ? left : right).set(data);
				},
				left,
			} as never;
		},
		createBufferSource() {
			const node: FakeSource = {
				buffer: null,
				startedAt: null,
				stopped: false,
				get left() {
					return (node.buffer as { left: Float32Array }).left;
				},
				connect: () => undefined,
				disconnect: () => undefined,
				start(when) {
					node.startedAt = when ?? 0;
				},
				stop() {
					node.stopped = true;
				},
			};
			sources.push(node);
			return node;
		},
	};
	return { context, state, gains, sources };
};

const makeTimers = () => {
	const intervals = new Set<() => void>();
	const timeouts: Array<{ at: number; run: () => void }> = [];
	let clock = 0;
	const timers: AudioSinkTimers = {
		repeat(callback) {
			intervals.add(callback);
			return callback;
		},
		cancelRepeat(handle) {
			intervals.delete(handle as () => void);
		},
		after(callback, ms) {
			timeouts.push({ at: clock + ms, run: callback });
			return callback;
		},
	};
	return {
		timers,
		tick: () => {
			for (const run of [...intervals]) run();
		},
		advance(ms: number) {
			clock += ms;
			for (const due of timeouts.filter((t) => t.at <= clock)) {
				timeouts.splice(timeouts.indexOf(due), 1);
				due.run();
			}
		},
		intervalCount: () => intervals.size,
	};
};

/** Stream of frames whose left sample equals the global frame index (offset by `firstFrame`). */
const makeSource = (totalFrames: number, firstFrame = 0, buffered = totalFrames) => {
	let position = 0;
	let available = buffered;
	let cancelled = false;
	const source: PcmSource & {
		cancelled(): boolean;
		makeAvailable(frames: number): void;
		position(): number;
	} = {
		get bufferedFrames() {
			return available - position;
		},
		get ended() {
			return available >= totalFrames && position >= totalFrames;
		},
		error: null,
		pull(frames) {
			const remaining = totalFrames - position;
			const ready = available - position;
			if (ready < frames && !(available >= totalFrames && ready > 0)) return null;
			const count = Math.min(frames, ready);
			const out = new Float32Array(count * 2);
			for (let i = 0; i < count; i += 1) {
				out[2 * i] = firstFrame + position + i;
				out[2 * i + 1] = -(firstFrame + position + i);
			}
			position += count;
			void remaining;
			return out;
		},
		skip(frames) {
			const count = Math.min(frames, available - position);
			position += count;
			return count;
		},
		ready: () => Promise.resolve(),
		cancel: () => {
			cancelled = true;
			return Promise.resolve();
		},
		cancelled: () => cancelled,
		makeAvailable(frames) {
			available = Math.min(totalFrames, available + frames);
		},
		position: () => position,
	};
	return source;
};

describe("audio sink", () => {
	it("schedules 20 ms chunks 100 ms ahead on a gapless sample grid and opens the stream at cursor + lead + latency", () => {
		const { context, state, sources } = makeContext(0.0128);
		const timing = makeTimers();
		const sink = createAudioSink({ context, timers: timing.timers });
		let openedAt = -1;
		const stream = makeSource(PCM_SAMPLE_RATE * 5);

		sink.play({
			cursorSeconds: 10,
			open: (start) => {
				openedAt = start;
				return stream;
			},
		});

		expect(openedAt).toBeCloseTo(10 + 0.02 + 0.0128, 6);
		// Lookahead 100 ms from a start lead of 20 ms: chunks at 20, 40, 60, 80 ms.
		expect(sources).toHaveLength(4);
		const starts = sources.map((s) => s.startedAt as number);
		expect(starts[0]).toBeCloseTo(0.02, 9);
		for (let i = 1; i < starts.length; i += 1) {
			expect(Math.round(((starts[i] as number) - (starts[i - 1] as number)) * PCM_SAMPLE_RATE)).toBe(960);
		}
		// Samples are the stream, in order.
		expect(sources[1]?.left[0]).toBe(960);

		state.currentTime = 0.5;
		timing.tick();
		const last = sources.at(-1)?.startedAt as number;
		expect(last - 0.5).toBeLessThan(0.12);
		expect(last - 0.5).toBeGreaterThanOrEqual(0.1 - 0.021);
		expect(sink.stats().lateEvents).toBeGreaterThan(0);
	});

	it("keeps the stream aligned to the device clock when data arrives late by dropping its head", () => {
		const { context, state, sources } = makeContext();
		const timing = makeTimers();
		const sink = createAudioSink({ context, timers: timing.timers });
		const stream = makeSource(PCM_SAMPLE_RATE * 5, 0, 0);

		sink.play({ cursorSeconds: 0, open: () => stream });
		expect(sources).toHaveLength(0);

		// 200 ms pass before the decoder delivers anything.
		state.currentTime = 0.2;
		stream.makeAvailable(PCM_SAMPLE_RATE);
		timing.tick();

		const first = sources[0]?.startedAt as number;
		expect(first).toBeGreaterThanOrEqual(0.2 + 0.005 - 1e-9);
		// The first scheduled sample is the one that belongs to that device time.
		const frameAtFirst = sources[0]?.left[0] as number;
		expect(frameAtFirst / PCM_SAMPLE_RATE).toBeCloseTo(first - 0.02, 3);
		expect(sink.stats().skippedFrames).toBeGreaterThan(0);
	});

	it("ramps the gain to zero in 5 ms on stop, then stops the sources and cancels the stream", () => {
		const { context, state, sources, gains } = makeContext();
		const timing = makeTimers();
		const sink = createAudioSink({ context, timers: timing.timers });
		const stream = makeSource(PCM_SAMPLE_RATE * 5);
		sink.play({ cursorSeconds: 0, open: () => stream });
		state.currentTime = 0.05;

		sink.stop();

		expect(sink.playing).toBe(false);
		expect(stream.cancelled()).toBe(true);
		expect(timing.intervalCount()).toBe(0);
		const playGain = gains[1] as FakeGain;
		expect(playGain.ramps).toEqual([{ value: 0, time: 0.05 + 0.005 }]);
		expect(sources.every((s) => !s.stopped)).toBe(true);
		timing.advance(30);
		expect(sources.every((s) => s.stopped)).toBe(true);
		expect(playGain.disconnected).toBe(true);
	});

	it("replaces a running play: old stream cancelled and ramped out, new stream scheduled", () => {
		const { context, state, gains } = makeContext();
		const timing = makeTimers();
		const sink = createAudioSink({ context, timers: timing.timers });
		const first = makeSource(PCM_SAMPLE_RATE * 5);
		const second = makeSource(PCM_SAMPLE_RATE * 5, 1000);
		sink.play({ cursorSeconds: 0, open: () => first });
		state.currentTime = 0.04;

		sink.play({ cursorSeconds: 3, open: () => second });

		expect(first.cancelled()).toBe(true);
		expect((gains[1] as FakeGain).ramps).toHaveLength(1);
		expect(second.cancelled()).toBe(false);
		expect(sink.playing).toBe(true);
		expect(sink.stats().plays).toBe(2);
	});

	it("schedules the final partial chunk, then reports the end once the audio has been heard", () => {
		const { context, state, sources } = makeContext();
		const timing = makeTimers();
		const sink = createAudioSink({ context, timers: timing.timers });
		let ended = 0;
		const stream = makeSource(1000);

		sink.play({ cursorSeconds: 0, open: () => stream, onEnded: () => (ended += 1) });

		expect(sources).toHaveLength(2);
		expect(sources[1]?.left).toHaveLength(40);
		expect(timing.intervalCount()).toBe(0);
		expect(ended).toBe(0);
		state.currentTime = 0.1;
		timing.advance(200);
		expect(ended).toBe(1);
		expect(sink.playing).toBe(false);
	});

	it("reports a stream failure and stops", () => {
		const { context } = makeContext();
		const timing = makeTimers();
		const sink = createAudioSink({ context, timers: timing.timers });
		const failure = new Error("decoder died");
		const stream = makeSource(PCM_SAMPLE_RATE);
		Object.defineProperty(stream, "error", { value: failure });
		let seen: Error | null = null;

		sink.play({ cursorSeconds: 0, open: () => stream, onError: (e) => (seen = e) });

		expect(seen).toBe(failure);
		expect(sink.playing).toBe(false);
	});

	it("applies master volume on its own gain node", () => {
		const { context, gains } = makeContext();
		const sink = createAudioSink({ context, timers: makeTimers().timers });

		sink.setMasterGain(0.5);
		sink.setMasterGain(9);

		expect((gains[0] as FakeGain).gain.value).toBe(1.5);
		expect((gains[0] as FakeGain).connected).toBe("destination");
	});

	it("rejects a context with another sample rate", () => {
		const { context } = makeContext();
		expect(() =>
			createAudioSink({ context: { ...context, sampleRate: 44100 } as AudioSinkContext }),
		).toThrow(/48000/);
	});
});
