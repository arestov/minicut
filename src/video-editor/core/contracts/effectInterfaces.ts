/**
 * DI interfaces consumed by model effects (`effects.api`).
 *
 * Models only call the methods declared here. Any host (browser, Node, fake)
 * supplies an implementation; results return through the task protocol, not
 * through return values.
 */

/** `$fx_renderExport` (SessionRoot) -> `#exportRuntime`. */
export interface ExportRuntimeInterface {
	requestExport(payload: unknown): void;
	/** `$fx_cancelExport` (SessionRoot): stop the running export named by `payload.id` / `payload.queueKey`. */
	cancelExport(payload: unknown): void;
}

/** `$fx_handleInputFiles` (SessionRoot) -> `#importRuntime`. */
export interface ImportRuntimeInterface {
	requestImportFiles(payload: unknown): void;
}

/** `$fx_mediaRecovery`, `$fx_mediaRecoveryCommit` (MediaRecoveryTask) -> `#mediaRecoveryRuntime`. */
export interface MediaRecoveryRuntimeInterface {
	requestMediaRecovery(payload: unknown): void;
	publishMediaPublicationDecision(payload: unknown): void;
	releaseMediaPublication(payload: unknown): void;
}

/**
 * `#mediaRestoreRuntime` (AppRoot): the platform restores media of attended
 * projects once per runtime boot. Optional per platform: an absent interface
 * is legal and the model schedules no boot restore; a declared one must be
 * complete. The model never checks the platform or the source kind. Restore
 * requests travel through the regular `$fx_mediaRecovery` effect, and the
 * runtime rejects a resource it cannot restore through its own task result.
 */
export interface MediaRestoreRuntimeInterface {
	readonly restoresMediaAtBoot: true;
}

/** `$fx_applyPlaybackRun` (SessionRoot) -> `#playbackRuntime`. */
export interface PlaybackRuntimeInterface {
	applyPlaybackRun(payload: unknown): void;
}

/** Timers and clock for effect executors (not used by models). */
export interface TimeInterface {
	setTimeout: typeof globalThis.setTimeout;
	clearTimeout: typeof globalThis.clearTimeout;
	Date: DateConstructor;
}

export interface MiniCutEffectInterfaces {
	time?: TimeInterface;
	exportRuntime: ExportRuntimeInterface;
	importRuntime: ImportRuntimeInterface;
	mediaRecoveryRuntime: MediaRecoveryRuntimeInterface;
	mediaRestoreRuntime?: MediaRestoreRuntimeInterface;
	playbackRuntime: PlaybackRuntimeInterface;
}
