import { expect, test } from "bun:test";
import type { PlaybackClock } from "../../../video-editor/playback/playbackRuntime";
import type { HostPage } from "../../../video-editor/hosts/desktop/hostTypes";
import type { PlaybackAudio } from "./desktopAudio";
import { createPlaybackExecutor } from "./playbackExecutor";

/** Clock the test advances by hand; frames run only when the test fires them. */
const manualClock = () => {
	let epoch = 1_000_000;
	let mono = 0;
	let next: (() => void) | null = null;
	const clock: PlaybackClock = {
		nowEpochMs: () => epoch,
		nowMonotonicMs: () => mono,
		requestFrame: (callback) => {
			next = callback;
			return 1;
		},
		cancelFrame: () => {
			next = null;
		},
	};
	return {
		clock,
		advance(ms: number) {
			epoch += ms;
			mono += ms;
			const frame = next;
			next = null;
			frame?.();
		},
	};
};

const recordingPage = () => {
	const dispatched: Array<{ action: string; payload: unknown }> = [];
	const page: HostPage = {
		dispatch: (action, payload) => {
			dispatched.push({ action, payload });
		},
		dispatchAndWait: () => Promise.resolve(),
		getRootScope: () => null,
	};
	return { page, dispatched };
};

test("a playback run advances the presentation time and reports completion at the boundary", () => {
	const { page, dispatched } = recordingPage();
	const time = manualClock();
	const executor = createPlaybackExecutor({ page, clock: time.clock });

	executor.handleRequest({
		run: {
			runId: 3,
			startCursorSeconds: 0,
			startedAtEpochMs: 1_000_000,
			playbackRate: 1,
			boundaryCursorSeconds: 2,
		},
		committedCursor: 0,
	});
	expect(executor.snapshot()).toMatchObject({ runId: 3, isPlaying: true, presentationTime: 0 });

	time.advance(1000);
	expect(executor.snapshot().presentationTime).toBeCloseTo(1, 5);
	expect(dispatched).toEqual([]);

	time.advance(1500);
	expect(executor.snapshot()).toMatchObject({ isPlaying: false, presentationTime: 2 });
	expect(dispatched).toEqual([
		{ action: "completePlayback", payload: { runId: 3, cursor: 2, reason: "boundary" } },
	]);
	executor.dispose();
});

test("a request without a run returns to the committed cursor", () => {
	const { page } = recordingPage();
	const time = manualClock();
	const executor = createPlaybackExecutor({ page, clock: time.clock });

	executor.handleRequest({ run: null, committedCursor: 4.5 });

	expect(executor.snapshot()).toMatchObject({ runId: null, isPlaying: false, presentationTime: 4.5 });
	executor.dispose();
});

type AudioCall = { kind: "start"; cursor: number } | { kind: "stop" };

const fakeAudio = (clock: PlaybackClock) => {
	const calls: AudioCall[] = [];
	const listeners = new Set<(change: "clock" | "mix") => void>();
	const audio: PlaybackAudio = {
		clock,
		start: (cursor) => calls.push({ kind: "start", cursor }),
		stop: () => calls.push({ kind: "stop" }),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setVolume: () => undefined,
		dispose: () => Promise.resolve(),
	};
	return {
		audio,
		calls,
		emit: (change: "clock" | "mix") => {
			for (const listener of listeners) listener(change);
		},
	};
};

const run = (runId: number, extra: Record<string, unknown> = {}) => ({
	runId,
	startCursorSeconds: 0,
	startedAtEpochMs: 1_000_000,
	playbackRate: 1,
	boundaryCursorSeconds: 10,
	...extra,
});

test("sound starts at the presented cursor of a new run and not again for the same run id", () => {
	const { page } = recordingPage();
	const time = manualClock();
	const sound = fakeAudio(time.clock);
	const executor = createPlaybackExecutor({ page, audio: sound.audio });

	executor.handleRequest({ run: run(1, { startCursorSeconds: 4, startedAtEpochMs: 1_000_000 }), committedCursor: 4 });
	expect(sound.calls).toEqual([{ kind: "start", cursor: 4 }]);

	// Boundary change re-applies the same run: no restart.
	executor.handleRequest({ run: run(1, { startCursorSeconds: 4, boundaryCursorSeconds: 20 }), committedCursor: 4 });
	expect(sound.calls).toHaveLength(1);

	// Seek during play: new run id, sound restarts at the new cursor.
	executor.handleRequest({ run: run(2, { startCursorSeconds: 7 }), committedCursor: 7 });
	expect(sound.calls.at(-1)).toEqual({ kind: "start", cursor: 7 });
	executor.dispose();
});

test("pause and reaching the boundary stop the sound", () => {
	const { page } = recordingPage();
	const time = manualClock();
	const sound = fakeAudio(time.clock);
	const executor = createPlaybackExecutor({ page, audio: sound.audio });

	executor.handleRequest({ run: run(1, { boundaryCursorSeconds: 1 }), committedCursor: 0 });
	time.advance(1500);
	expect(sound.calls).toEqual([{ kind: "start", cursor: 0 }, { kind: "stop" }]);

	executor.handleRequest({ run: run(2, { boundaryCursorSeconds: 9 }), committedCursor: 0 });
	executor.handleRequest({ run: null, committedCursor: 2.5 });
	expect(sound.calls.at(-1)).toEqual({ kind: "stop" });
	expect(sound.calls.filter((call) => call.kind === "start")).toHaveLength(2);
	executor.dispose();
});

test("rates other than 1 play silently", () => {
	const { page } = recordingPage();
	const time = manualClock();
	const sound = fakeAudio(time.clock);
	const executor = createPlaybackExecutor({ page, audio: sound.audio });

	executor.handleRequest({ run: run(1, { playbackRate: 2 }), committedCursor: 0 });

	expect(sound.calls).toEqual([]);
	expect(executor.snapshot().isPlaying).toBe(true);
	executor.dispose();
});

test("a clock switch re-anchors the run on the new clock and restarts the sound", () => {
	const { page } = recordingPage();
	const time = manualClock();
	const sound = fakeAudio(time.clock);
	const executor = createPlaybackExecutor({ page, audio: sound.audio });
	executor.handleRequest({ run: run(1), committedCursor: 0 });
	time.advance(2000);

	sound.emit("clock");

	expect(sound.calls.slice(-2)).toEqual([
		{ kind: "stop" },
		{ kind: "start", cursor: expect.closeTo(2, 3) as unknown as number },
	]);
	expect(executor.snapshot().presentationTime).toBeCloseTo(2, 3);
	executor.dispose();
});

test("a changed mix restarts the sound from the presented cursor while playing, and is ignored at rest", () => {
	const { page } = recordingPage();
	const time = manualClock();
	const sound = fakeAudio(time.clock);
	const executor = createPlaybackExecutor({ page, audio: sound.audio });

	sound.emit("mix");
	expect(sound.calls).toEqual([]);

	executor.handleRequest({ run: run(1), committedCursor: 0 });
	time.advance(1000);
	sound.emit("mix");

	expect(sound.calls).toHaveLength(2);
	expect(sound.calls[1]).toMatchObject({ kind: "start" });
	expect((sound.calls[1] as { cursor: number }).cursor).toBeCloseTo(1, 3);
	executor.dispose();
});
