import { type Accessor, createSignal } from "solid-js";
import {
	type PlaybackClock,
	type PlaybackRun,
	PlaybackRuntime,
	type PlaybackSnapshot,
} from "../../../video-editor/playback/playbackRuntime";
import type { HostPage } from "./hostTypes";

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
 * Playback executor without audio (the audio sink is a later stage): it runs
 * the same `PlaybackRuntime` the Web page uses, so the presentation time
 * advances along the model's run and reaching the boundary reports
 * `completePlayback` (its own dispatch, same delivery as web page executors).
 * The model cursor stays the committed truth.
 */
export const createPlaybackExecutor = ({
	page,
	clock = timerPlaybackClock(),
}: {
	page: HostPage;
	clock?: PlaybackClock;
}): PlaybackExecutor => {
	const runtime = new PlaybackRuntime({
		clock,
		onComplete(completion) {
			page.dispatch("completePlayback", completion, null);
		},
	});
	const [snapshot, setSnapshot] = createSignal<PlaybackSnapshot>(
		runtime.getSnapshot(),
		{ equals: false },
	);
	const stop = runtime.subscribe(() => setSnapshot(runtime.getSnapshot()));

	return {
		handleRequest(payload) {
			const value =
				payload && typeof payload === "object"
					? (payload as { run?: PlaybackRun | null; committedCursor?: unknown })
					: null;
			runtime.applyRun(
				value?.run ?? null,
				typeof value?.committedCursor === "number"
					? value.committedCursor
					: runtime.getSnapshot().presentationTime,
			);
		},
		snapshot,
		dispose() {
			stop();
			runtime.dispose();
		},
	};
};
