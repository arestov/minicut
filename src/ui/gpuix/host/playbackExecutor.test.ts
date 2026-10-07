import { expect, test } from "bun:test";
import type { PlaybackClock } from "../../../video-editor/playback/playbackRuntime";
import type { HostPage } from "../../../video-editor/hosts/desktop/hostTypes";
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
