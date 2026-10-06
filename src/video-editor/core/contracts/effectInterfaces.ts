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
}

/** `$fx_handleInputFiles` (SessionRoot) -> `#importRuntime`. */
export interface ImportRuntimeInterface {
	requestImportFiles(payload: unknown): void;
}

/** `$fx_mediaRecovery`, `$fx_mediaRecoveryCommit` (MediaRecoveryTask) -> `#mediaRecoveryRuntime`. */
export interface MediaRecoveryRuntimeInterface {
	requestMediaRecovery(payload: unknown): void;
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
	time: TimeInterface;
	exportRuntime: ExportRuntimeInterface;
	importRuntime: ImportRuntimeInterface;
	mediaRecoveryRuntime: MediaRecoveryRuntimeInterface;
	playbackRuntime: PlaybackRuntimeInterface;
}
