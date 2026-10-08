import {
	createManifestExportRenderer,
	type ExportRenderer,
} from "../../render/exportRenderer";
import { createFallbackAuthorityClient } from "../../worker/fallbackAuthorityClient";
import { createProjectAssetStore } from "../../media/projectAssetStore";
import type { PlaybackClock } from "../../playback/playbackRuntime";
import type { VideoEditorHarnessPlatform } from "./types";

const fallbackMediaDuration = 6;
const imageDuration = 1;

const NODE_PLAYBACK_FRAME_MS = 16;

const nodePlaybackClock: PlaybackClock = {
	nowEpochMs: () => Date.now(),
	nowMonotonicMs: () => performance.now(),
	requestFrame: (callback) =>
		setTimeout(callback, NODE_PLAYBACK_FRAME_MS) as unknown as number,
	cancelFrame: (frameId) =>
		clearTimeout(frameId as unknown as ReturnType<typeof setTimeout>),
};

export interface CreateNodeHarnessPlatformOptions {
	exportRenderer?: ExportRenderer;
}

export const createNodeHarnessPlatform = (
	options: CreateNodeHarnessPlatformOptions = {},
): VideoEditorHarnessPlatform => ({
	createAuthorityClient: () => createFallbackAuthorityClient(),
	createExportRenderer: () =>
		options.exportRenderer ?? createManifestExportRenderer(),
	async getImportedResourceDuration(_url, kind) {
		if (kind === "image") {
			return imageDuration;
		}

		return fallbackMediaDuration;
	},
	probeMediaFile() {
		return Promise.reject(
			new Error("Media probing is not available in the Node harness platform"),
		);
	},
	async probeAudioStreams() {
		return null;
	},
	createProjectAssetStore: () => createProjectAssetStore(async () => null),
	playbackClock: nodePlaybackClock,
	async estimateStorage() {
		return {};
	},
	downloadFile() {
		// no-op in headless node runtime
	},
	resolveCrdtBridgeSender: () => undefined,
	createObjectUrl() {
		return null;
	},
	revokeObjectUrl() {
		// no-op in headless node runtime
	},
	setTimeout(handler, timeoutMs) {
		return setTimeout(handler, timeoutMs);
	},
	clearTimeout(timerId) {
		clearTimeout(timerId);
	},
});
