import { describe, expect, it, vi } from "vitest";
import {
	PlaybackRuntime,
	type PlaybackClock,
	type PlaybackCompletion,
	type PlaybackRun,
} from "./playbackRuntime";

const createManualClock = () => {
	let epochMs = 10_000;
	let monotonicMs = 0;
	let nextFrameId = 0;
	const frames = new Map<number, () => void>();
	const clock: PlaybackClock = {
		nowEpochMs: () => epochMs,
		nowMonotonicMs: () => monotonicMs,
		requestFrame(callback) {
			const frameId = ++nextFrameId;
			frames.set(frameId, callback);
			return frameId;
		},
		cancelFrame(frameId) {
			frames.delete(frameId);
		},
	};
	return {
		clock,
		setEpoch(value: number) {
			epochMs = value;
		},
		setMonotonic(value: number) {
			monotonicMs = value;
		},
		frame() {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const callback of callbacks) callback();
		},
		pendingFrames: () => frames.size,
	};
};

const run = (overrides: Partial<PlaybackRun> = {}): PlaybackRun => ({
	runId: 1,
	startCursorSeconds: 0,
	startedAtEpochMs: 10_000,
	playbackRate: 1,
	boundaryCursorSeconds: 2,
	...overrides,
});

describe("PlaybackRuntime", () => {
	it("advances presentation time from a monotonic anchor", () => {
		const manual = createManualClock();
		const runtime = new PlaybackRuntime({ clock: manual.clock, onComplete() {} });

		runtime.applyRun(run());
		manual.setMonotonic(500);
		manual.frame();

		expect(runtime.getSnapshot()).toMatchObject({
			runId: 1,
			presentationTime: 0.5,
			isPlaying: true,
		});
	});

	it("catches up effect delivery latency once, then stays monotonic", () => {
		const manual = createManualClock();
		manual.setEpoch(10_250);
		manual.setMonotonic(5_000);
		const runtime = new PlaybackRuntime({ clock: manual.clock, onComplete() {} });

		runtime.applyRun(run({ startCursorSeconds: 3, boundaryCursorSeconds: 5 }));
		expect(runtime.getSnapshot().presentationTime).toBe(3.25);

		manual.setEpoch(99_000);
		manual.setMonotonic(5_500);
		manual.frame();
		expect(runtime.getSnapshot().presentationTime).toBe(3.75);
	});

	it("applies playback rate and completes once at the boundary", () => {
		const manual = createManualClock();
		const completions: PlaybackCompletion[] = [];
		const runtime = new PlaybackRuntime({
			clock: manual.clock,
			onComplete: (completion) => completions.push(completion),
		});

		runtime.applyRun(run({ playbackRate: 2, boundaryCursorSeconds: 1 }));
		manual.setMonotonic(500);
		manual.frame();
		manual.frame();

		expect(runtime.getSnapshot()).toMatchObject({
			presentationTime: 1,
			isPlaying: false,
		});
		expect(completions).toEqual([{ runId: 1, cursor: 1, reason: "boundary" }]);
	});

	it("cancels stale frames when a newer run replaces the current run", () => {
		const manual = createManualClock();
		const runtime = new PlaybackRuntime({ clock: manual.clock, onComplete() {} });

		runtime.applyRun(run());
		expect(manual.pendingFrames()).toBe(1);
		runtime.applyRun(run({ runId: 2, startCursorSeconds: 1 }));
		expect(manual.pendingFrames()).toBe(1);

		manual.setMonotonic(250);
		manual.frame();
		expect(runtime.getSnapshot()).toMatchObject({
			runId: 2,
			presentationTime: 1.25,
		});
	});

	it("keeps scrub movement transient until the caller commits it", () => {
		const manual = createManualClock();
		const runtime = new PlaybackRuntime({ clock: manual.clock, onComplete() {} });
		const listener = vi.fn();
		runtime.subscribe(listener);

		runtime.applyRun(null, 1);
		runtime.beginScrub(2);
		runtime.updateScrub(3);
		runtime.updateScrub(4);

		expect(runtime.getSnapshot()).toMatchObject({
			presentationTime: 4,
			isPlaying: false,
			isScrubbing: true,
		});
		runtime.endScrub(4);
		expect(runtime.getSnapshot()).toMatchObject({
			presentationTime: 4,
			isScrubbing: false,
		});
		expect(listener).toHaveBeenCalled();
	});

	it("disposal cancels the scheduled frame", () => {
		const manual = createManualClock();
		const runtime = new PlaybackRuntime({ clock: manual.clock, onComplete() {} });
		runtime.applyRun(run());
		runtime.dispose();
		expect(manual.pendingFrames()).toBe(0);
	});
});
