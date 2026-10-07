import { describe, expect, it } from "vitest";
import { PlaybackRuntime, type PlaybackRun } from "../../../playback/playbackRuntime";
import {
	createAudioPlaybackClock,
	createOutputLatencyEstimator,
} from "./audioPlaybackClock";

const setup = (ctxPatch: { outputLatency?: number } = {}) => {
	const ctx = { currentTime: 0, outputLatency: ctxPatch.outputLatency ?? 0, state: "running" };
	let system = 1000;
	const frames = new Map<number, () => void>();
	let nextId = 1;
	const clock = createAudioPlaybackClock(ctx, {
		systemMonotonicMs: () => system,
		nowEpochMs: () => 5_000_000 + system,
		requestFrame: (cb) => {
			frames.set(nextId, cb);
			return nextId++;
		},
		cancelFrame: (id) => void frames.delete(id),
	});
	/** Advance real time by dtMs; the audio clock moves with `audioRate` and quantised steps. */
	let trueAudio = 0;
	const tick = (dtMs: number, audioRate = 1, stepMs = 0) => {
		system += dtMs;
		trueAudio += (dtMs / 1000) * audioRate;
		const next = trueAudio;
		ctx.currentTime = stepMs > 0 ? Math.floor((next * 1000) / stepMs) * (stepMs / 1000) : next;
	};
	const runFrame = () => {
		const [id, cb] = [...frames.entries()][0] ?? [];
		if (id === undefined || !cb) throw new Error("no frame scheduled");
		frames.delete(id);
		cb();
	};
	return { ctx, clock, tick, runFrame, frames };
};

describe("createAudioPlaybackClock", () => {
	it("never goes backwards while the audio clock advances in coarse steps", () => {
		const { clock, tick } = setup();
		let prev = clock.nowMonotonicMs();
		for (let i = 0; i < 600; i++) {
			tick(16.7, 1, 10.7);
			const now = clock.nowMonotonicMs();
			expect(now).toBeGreaterThanOrEqual(prev);
			prev = now;
		}
		expect(prev).toBeGreaterThan(9_500);
	});

	it("follows the audio clock when it runs slower than the system clock", () => {
		const { ctx, clock, tick } = setup();
		clock.nowMonotonicMs();
		// 30 s of system time with an audio clock 0.1% slow: 30 ms behind in total
		for (let i = 0; i < 1800; i++) {
			tick(16.667, 0.999);
			clock.nowMonotonicMs();
		}
		const reported = clock.nowMonotonicMs();
		expect(Math.abs(reported - ctx.currentTime * 1000)).toBeLessThan(5);
	});

	it("subtracts output latency so time means audible time", () => {
		const { clock, tick } = setup({ outputLatency: 0.0128 });
		tick(100);
		const base = clock.nowMonotonicMs();
		tick(100);
		expect(clock.nowMonotonicMs() - base).toBeCloseTo(100, 0);
		expect(base).toBeCloseTo(100 - 12.8, 0);
	});

	it("freezes while the context is not running and resyncs on resume", () => {
		const { ctx, clock, tick } = setup();
		tick(100);
		const before = clock.nowMonotonicMs();
		ctx.state = "suspended";
		tick(500, 0);
		expect(clock.nowMonotonicMs()).toBe(before);
		ctx.state = "running";
		tick(100);
		const after = clock.nowMonotonicMs();
		expect(after - before).toBeCloseTo(100, 0);
	});

	it("advances PlaybackRuntime from the audio clock without a device", () => {
		const { clock, tick, runFrame } = setup();
		const completions: number[] = [];
		const runtime = new PlaybackRuntime({ clock, onComplete: (c) => completions.push(c.cursor) });
		const run: PlaybackRun = {
			runId: 1,
			startCursorSeconds: 2,
			startedAtEpochMs: clock.nowEpochMs(),
			playbackRate: 1,
			boundaryCursorSeconds: 3,
		};
		runtime.applyRun(run);
		expect(runtime.getSnapshot().presentationTime).toBeCloseTo(2, 3);
		for (let i = 0; i < 30; i++) {
			tick(16.667, 1, 2.67);
			runFrame();
		}
		const mid = runtime.getSnapshot();
		expect(mid.isPlaying).toBe(true);
		expect(mid.presentationTime).toBeGreaterThan(2.45);
		expect(mid.presentationTime).toBeLessThan(2.51);
		// the audio clock stalls (device hiccup): the cursor must not run ahead of audible time
		tick(300, 0);
		runFrame();
		expect(runtime.getSnapshot().presentationTime).toBeLessThan(2.51 + 0.31);
		for (let i = 0; i < 60; i++) {
			tick(16.667);
			runFrame();
			if (!runtime.getSnapshot().isPlaying) break;
		}
		expect(runtime.getSnapshot().isPlaying).toBe(false);
		expect(completions).toEqual([3]);
	});
});

describe("createOutputLatencyEstimator", () => {
	it("takes the median of recent readings so a latency that flickers to zero does not move the clock", () => {
		const ctx = { outputLatency: 0.0128 };
		const estimator = createOutputLatencyEstimator(ctx, 9);
		for (let i = 0; i < 9; i += 1) estimator.sample();
		expect(estimator.value()).toBeCloseTo(0.0128, 6);

		ctx.outputLatency = 0;
		estimator.sample();
		estimator.sample();
		expect(estimator.value()).toBeCloseTo(0.0128, 6);

		for (let i = 0; i < 9; i += 1) estimator.sample();
		expect(estimator.value()).toBe(0);
	});
});
