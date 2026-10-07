import type { MediaErrorInfo } from "./errors";

export type JobStage = "queued" | "preparing" | "rendering" | "finalizing";

export interface JobProgressEvent {
	requestId: string;
	stage: JobStage;
	/** 0..1 */
	ratio: number;
}

export interface FileArtifact {
	path: string;
	size: number;
	durationSeconds: number;
	frameCount: number;
}

export type JobOutcome<TArtifact> =
	| { status: "done"; artifact: TArtifact }
	| { status: "error"; error: MediaErrorInfo }
	| { status: "cancelled" };

export type Unsubscribe = () => void;

/**
 * A running media job. Independent of DKT: wrappers can map the per-event
 * subscriptions or the `outcome` promise to any delivery form.
 * Listeners subscribed after a terminal event are invoked once with the
 * recorded terminal event (no lost events).
 */
export interface MediaJob<TArtifact> {
	readonly requestId: string;
	onProgress(listener: (event: JobProgressEvent) => void): Unsubscribe;
	onDone(listener: (artifact: TArtifact) => void): Unsubscribe;
	onError(listener: (error: MediaErrorInfo) => void): Unsubscribe;
	onCancelled(listener: () => void): Unsubscribe;
	/** Request cancellation; idempotent. Outcome resolves to `cancelled`. */
	cancel(): void;
	/** Resolves once with the terminal outcome; never rejects. */
	readonly outcome: Promise<JobOutcome<TArtifact>>;
}
