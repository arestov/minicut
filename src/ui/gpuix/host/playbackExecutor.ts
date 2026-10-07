import { type Accessor, createSignal } from "solid-js";
import {
	type PlaybackClock,
	type PlaybackRun,
	PlaybackRuntime,
	type PlaybackSnapshot,
} from "../../../video-editor/playback/playbackRuntime";
import type { HostPage } from "../../../video-editor/hosts/desktop/hostTypes";
import type { PlaybackAudio } from "./desktopAudio";

/** Playback clock on timers (no display frame callback in the Bun host). */
export const timerPlaybackClock = (frameMs = 16): PlaybackClock => ({
	nowEpochMs: () => Date.now(),
	nowMonotonicMs: () => performance.now(),
	requestFrame: (callback) =>
		setTimeout(callback, frameMs) as unknown as number,
	cancelFrame: (frameId) => clearTimeout(frameId as unknown as NodeJS.Timeout),
});

export type PlaybackExecutor = {
	/** Handler of the `$fx_applyPlaybackRun` task request published by the host. */
	handleRequest(payload: unknown): void;
	/** Where playback currently is; follows the run, not the committed cursor. */
	readonly snapshot: Accessor<PlaybackSnapshot>;
	dispose(): void;
};

/**
 * Playback executor: it runs the same `PlaybackRuntime` the Web page uses, so
 * the presentation time advances along the model's run and reaching the
 * boundary reports `completePlayback` (its own dispatch, same delivery as web
 * page executors). The model cursor stays the committed truth.
 *
 * With `audio`, the runtime follows the audio clock and sound plays from the
 * presented cursor: a new run (play, seek, rate change) restarts the sound at
 * the cursor, reaching the boundary or pausing stops it, and a run that
 * re-applies with the same id (boundary change) leaves the sound running.
 * Only rate 1 is audible; other rates stay silent (no time stretching).
 * Without a device the audio object is absent and the system clock drives time.
 */
export const createPlaybackExecutor = ({
	page,
	clock = timerPlaybackClock(),
	audio,
}: {
	page: HostPage;
	clock?: PlaybackClock;
	audio?: PlaybackAudio;
}): PlaybackExecutor => {
	const runtime = new PlaybackRuntime({
		clock: audio?.clock ?? clock,
		onComplete(completion) {
			page.dispatch("completePlayback", completion, null);
		},
	});
	const [snapshot, setSnapshot] = createSignal<PlaybackSnapshot>(
		runtime.getSnapshot(),
		{ equals: false },
	);
	let lastRequest: { run: PlaybackRun | null; committedCursor: number } | null = null;
	let soundRunId: number | null = null;

	const syncSound = (): void => {
		if (!audio) return;
		const current = runtime.getSnapshot();
		const run = lastRequest?.run ?? null;
		if (!current.isPlaying || run === null || run.playbackRate !== 1) {
			if (soundRunId !== null) {
				soundRunId = null;
				audio.stop();
			}
			return;
		}
		if (soundRunId === run.runId) return;
		soundRunId = run.runId;
		audio.start(current.presentationTime);
	};

	const stop = runtime.subscribe(() => {
		setSnapshot(runtime.getSnapshot());
		if (soundRunId !== null && !runtime.getSnapshot().isPlaying) syncSound();
	});
	const stopAudioEvents = audio?.subscribe((change) => {
		if (change === "clock") {
			// The time source changed: anchor the same run on the new clock and
			// restart sound from the re-anchored cursor.
			if (lastRequest) {
				soundRunId = null;
				audio.stop();
				runtime.applyRun(lastRequest.run, lastRequest.committedCursor);
				syncSound();
			}
			return;
		}
		if (soundRunId !== null) {
			soundRunId = null;
			syncSound();
		}
	});

	return {
		handleRequest(payload) {
			const value =
				payload && typeof payload === "object"
					? (payload as { run?: PlaybackRun | null; committedCursor?: unknown })
					: null;
			const committedCursor =
				typeof value?.committedCursor === "number"
					? value.committedCursor
					: runtime.getSnapshot().presentationTime;
			lastRequest = { run: value?.run ?? null, committedCursor };
			runtime.applyRun(lastRequest.run, committedCursor);
			syncSound();
		},
		snapshot,
		dispose() {
			stopAudioEvents?.();
			stop();
			runtime.dispose();
			audio?.stop();
		},
	};
};
