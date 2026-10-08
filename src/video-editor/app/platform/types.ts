import type { AudioStreamsInfo } from "../../media/audioStreamSniffer";
import type { ProjectAssetStore } from "../../media/projectAssetStore";
import type { PlaybackClock } from "../../playback/playbackRuntime";
import type { ExportRenderer } from "../../render/exportRenderer";
import type { EditorAuthorityClient } from "../../worker/authorityClient";
import type { MiniCutCrdtPageBridgeSender } from "../../dkt/runtime/createMiniCutPageSyncRuntime";
import type { AuthorityResourceBindings } from "../../worker/createAuthorityClient";

export type HarnessMediaProbeResult = Awaited<
	ReturnType<typeof import("../../media/browserMediaProbe").probeBrowserMediaFile>
>;

export interface VideoEditorHarnessPlatform {
	createAuthorityClient(
		bindings?: AuthorityResourceBindings,
	): EditorAuthorityClient;
	createExportRenderer(): ExportRenderer;
	getImportedResourceDuration(
		url: string,
		kind: "video" | "audio" | "image",
	): Promise<number>;
	createObjectUrl(source: Blob): string | null;
	revokeObjectUrl(url: string): void;
	probeMediaFile(file: File, signal?: AbortSignal): Promise<HarnessMediaProbeResult>;
	/** Audio streams of a file from its container header; null when unknown. */
	probeAudioStreams(file: File): Promise<AudioStreamsInfo | null>;
	/**
	 * Host-owned import (desktop config B): the host imports picked files from
	 * their local paths on its media service. Returns the batch id the model's
	 * `requestImportFiles` carries, or null when the files cannot be staged
	 * (not path-backed, not media). Absent on Web, where the page imports.
	 */
	stageHostImport?(files: readonly File[]): string | null;
	createProjectAssetStore(): ProjectAssetStore;
	readonly playbackClock: PlaybackClock;
	estimateStorage(): Promise<StorageEstimate | Record<string, never>>;
	downloadFile(url: string, fileName: string): void;
	resolveCrdtBridgeSender(): MiniCutCrdtPageBridgeSender | undefined;
	setTimeout(
		handler: () => void,
		timeoutMs: number,
	): ReturnType<typeof setTimeout>;
	clearTimeout(timerId: ReturnType<typeof setTimeout>): void;
}
