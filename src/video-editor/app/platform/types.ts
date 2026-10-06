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
