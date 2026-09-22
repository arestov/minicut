export type PlaybackRun = {
	runId: number;
	startCursorSeconds: number;
	startedAtEpochMs: number;
	playbackRate: number;
	boundaryCursorSeconds: number;
};

export type PlaybackCompletion = {
	runId: number;
	cursor: number;
	reason: "boundary";
};

export type PlaybackSnapshot = {
	runId: number | null;
	presentationTime: number;
	isPlaying: boolean;
	isScrubbing: boolean;
};

export type PlaybackClock = {
	nowEpochMs(): number;
	nowMonotonicMs(): number;
	requestFrame(callback: () => void): number;
	cancelFrame(frameId: number): void;
};

export type PlaybackRuntimeOptions = {
	clock: PlaybackClock;
	onComplete(completion: PlaybackCompletion): void;
};

const finite = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

const normalizeRun = (run: PlaybackRun): PlaybackRun => {
	const startCursorSeconds = Math.max(0, finite(run.startCursorSeconds, 0));
	return {
		runId: run.runId,
		startCursorSeconds,
		startedAtEpochMs: finite(run.startedAtEpochMs, 0),
		playbackRate: Math.max(0, finite(run.playbackRate, 1)),
		boundaryCursorSeconds: Math.max(
			startCursorSeconds,
			finite(run.boundaryCursorSeconds, startCursorSeconds),
		),
	};
};

export class PlaybackRuntime {
	readonly #clock: PlaybackClock;
	readonly #onComplete: (completion: PlaybackCompletion) => void;
	readonly #listeners = new Set<() => void>();
	#run: PlaybackRun | null = null;
	#anchorProjectSeconds = 0;
	#anchorMonotonicMs = 0;
	#frameId: number | null = null;
	#completedRunId: number | null = null;
	#snapshot: PlaybackSnapshot = {
		runId: null,
		presentationTime: 0,
		isPlaying: false,
		isScrubbing: false,
	};

	constructor(options: PlaybackRuntimeOptions) {
		this.#clock = options.clock;
		this.#onComplete = options.onComplete;
	}

	getSnapshot = (): PlaybackSnapshot => this.#snapshot;

	subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	};

	applyRun(run: PlaybackRun | null, committedCursor = this.#snapshot.presentationTime): void {
		this.#cancelScheduledFrame();
		if (!run) {
			this.#run = null;
			this.#publish({
				runId: null,
				presentationTime: Math.max(0, finite(committedCursor, 0)),
				isPlaying: false,
				isScrubbing: false,
			});
			return;
		}

		const normalized = normalizeRun(run);
		const elapsedSinceDktStartSeconds = Math.max(
			0,
			(this.#clock.nowEpochMs() - normalized.startedAtEpochMs) / 1000,
		);
		this.#run = normalized;
		this.#completedRunId = null;
		this.#anchorProjectSeconds = Math.min(
			normalized.boundaryCursorSeconds,
			normalized.startCursorSeconds +
				elapsedSinceDktStartSeconds * normalized.playbackRate,
		);
		this.#anchorMonotonicMs = this.#clock.nowMonotonicMs();
		this.#publish({
			runId: normalized.runId,
			presentationTime: this.#anchorProjectSeconds,
			isPlaying: this.#anchorProjectSeconds < normalized.boundaryCursorSeconds,
			isScrubbing: false,
		});
		if (this.#snapshot.isPlaying) {
			this.#scheduleFrame();
		} else {
			this.#completeAtBoundary(normalized);
		}
	}

	beginScrub(cursor: number): void {
		this.#cancelScheduledFrame();
		this.#publish({
			...this.#snapshot,
			presentationTime: Math.max(0, finite(cursor, 0)),
			isPlaying: false,
			isScrubbing: true,
		});
	}

	updateScrub(cursor: number): void {
		if (!this.#snapshot.isScrubbing) return;
		this.#publish({
			...this.#snapshot,
			presentationTime: Math.max(0, finite(cursor, 0)),
		});
	}

	endScrub(committedCursor: number): void {
		this.#run = null;
		this.#publish({
			runId: null,
			presentationTime: Math.max(0, finite(committedCursor, 0)),
			isPlaying: false,
			isScrubbing: false,
		});
	}

	dispose(): void {
		this.#cancelScheduledFrame();
		this.#run = null;
		this.#listeners.clear();
	}

	#scheduleFrame(): void {
		this.#frameId = this.#clock.requestFrame(() => {
			this.#frameId = null;
			this.#advance();
		});
	}

	#advance(): void {
		const run = this.#run;
		if (!run || this.#snapshot.isScrubbing) return;
		const elapsedSeconds = Math.max(
			0,
			(this.#clock.nowMonotonicMs() - this.#anchorMonotonicMs) / 1000,
		);
		const presentationTime = Math.min(
			run.boundaryCursorSeconds,
			this.#anchorProjectSeconds + elapsedSeconds * run.playbackRate,
		);
		const isPlaying = presentationTime < run.boundaryCursorSeconds;
		this.#publish({
			runId: run.runId,
			presentationTime,
			isPlaying,
			isScrubbing: false,
		});
		if (isPlaying) {
			this.#scheduleFrame();
		} else {
			this.#completeAtBoundary(run);
		}
	}

	#completeAtBoundary(run: PlaybackRun): void {
		if (this.#completedRunId === run.runId) return;
		this.#completedRunId = run.runId;
		this.#onComplete({
			runId: run.runId,
			cursor: run.boundaryCursorSeconds,
			reason: "boundary",
		});
	}

	#cancelScheduledFrame(): void {
		if (this.#frameId === null) return;
		this.#clock.cancelFrame(this.#frameId);
		this.#frameId = null;
	}

	#publish(snapshot: PlaybackSnapshot): void {
		if (
			this.#snapshot.runId === snapshot.runId &&
			this.#snapshot.presentationTime === snapshot.presentationTime &&
			this.#snapshot.isPlaying === snapshot.isPlaying &&
			this.#snapshot.isScrubbing === snapshot.isScrubbing
		) {
			return;
		}
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) listener();
	}
}

export const browserPlaybackClock: PlaybackClock = {
	nowEpochMs: () => Date.now(),
	nowMonotonicMs: () => performance.now(),
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (frameId) => cancelAnimationFrame(frameId),
};
