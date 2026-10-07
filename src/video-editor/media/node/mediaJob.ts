import type { MediaErrorInfo } from "../contracts/errors";
import type {
	JobOutcome,
	JobProgressEvent,
	MediaJob,
	Unsubscribe,
} from "../contracts/job";

/** Listener failures are logged and never propagate into job execution. */
const safeCall = (invoke: () => void): void => {
	try {
		invoke();
	} catch (error) {
		console.error("[media-job] listener threw", error);
	}
};

/**
 * Controller side of a MediaJob: the service drives it, consumers subscribe.
 * Terminal events are recorded and replayed to late subscribers.
 */
export class MediaJobController<TArtifact> implements MediaJob<TArtifact> {
	readonly requestId: string;
	readonly outcome: Promise<JobOutcome<TArtifact>>;

	private resolveOutcome!: (outcome: JobOutcome<TArtifact>) => void;
	private terminal: JobOutcome<TArtifact> | null = null;
	private lastProgress: JobProgressEvent | null = null;
	private progressListeners = new Set<(event: JobProgressEvent) => void>();
	private doneListeners = new Set<(artifact: TArtifact) => void>();
	private errorListeners = new Set<(error: MediaErrorInfo) => void>();
	private cancelledListeners = new Set<() => void>();
	private cancelRequestedFlag = false;
	private cancelHandler: (() => void) | null = null;

	constructor(requestId: string) {
		this.requestId = requestId;
		this.outcome = new Promise((resolve) => {
			this.resolveOutcome = resolve;
		});
	}

	get cancelRequested(): boolean {
		return this.cancelRequestedFlag;
	}

	get settled(): boolean {
		return this.terminal !== null;
	}

	/** Installed by the service; invoked on the first cancel() call. */
	setCancelHandler(handler: () => void): void {
		this.cancelHandler = handler;
		if (this.cancelRequestedFlag) handler();
	}

	onProgress(listener: (event: JobProgressEvent) => void): Unsubscribe {
		this.progressListeners.add(listener);
		const last = this.lastProgress;
		if (last && !this.terminal) safeCall(() => listener(last));
		return () => this.progressListeners.delete(listener);
	}

	onDone(listener: (artifact: TArtifact) => void): Unsubscribe {
		this.doneListeners.add(listener);
		if (this.terminal?.status === "done") {
			const { artifact } = this.terminal;
			safeCall(() => listener(artifact));
		}
		return () => this.doneListeners.delete(listener);
	}

	onError(listener: (error: MediaErrorInfo) => void): Unsubscribe {
		this.errorListeners.add(listener);
		if (this.terminal?.status === "error") {
			const { error } = this.terminal;
			safeCall(() => listener(error));
		}
		return () => this.errorListeners.delete(listener);
	}

	onCancelled(listener: () => void): Unsubscribe {
		this.cancelledListeners.add(listener);
		if (this.terminal?.status === "cancelled") safeCall(listener);
		return () => this.cancelledListeners.delete(listener);
	}

	cancel(): void {
		if (this.cancelRequestedFlag || this.terminal) return;
		this.cancelRequestedFlag = true;
		this.cancelHandler?.();
	}

	emitProgress(event: Omit<JobProgressEvent, "requestId">): void {
		if (this.terminal) return;
		const full: JobProgressEvent = { requestId: this.requestId, ...event };
		this.lastProgress = full;
		for (const listener of [...this.progressListeners]) {
			safeCall(() => listener(full));
		}
	}

	done(artifact: TArtifact): void {
		if (!this.settle({ status: "done", artifact })) return;
		for (const listener of [...this.doneListeners]) {
			safeCall(() => listener(artifact));
		}
	}

	fail(error: MediaErrorInfo): void {
		if (!this.settle({ status: "error", error })) return;
		for (const listener of [...this.errorListeners]) {
			safeCall(() => listener(error));
		}
	}

	cancelled(): void {
		if (!this.settle({ status: "cancelled" })) return;
		for (const listener of [...this.cancelledListeners]) safeCall(listener);
	}

	private settle(outcome: JobOutcome<TArtifact>): boolean {
		if (this.terminal) return false;
		this.terminal = outcome;
		this.resolveOutcome(outcome);
		return true;
	}
}
