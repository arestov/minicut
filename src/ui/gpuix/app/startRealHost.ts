import { stat } from "node:fs/promises";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import {
	createNodeAssetRegistry,
	nodeAssetRegistryPathFor,
} from "../../../video-editor/adapters/node/nodeAssetRegistry";
import { fingerprintNodeFile } from "../../../video-editor/adapters/node/nodeFileFingerprint";
import {
	resolveNodeAudioMixCacheDir,
	resolveNodePreviewProxyDir,
} from "../../../video-editor/adapters/node/nodeProfileLayout";
import { createPreviewProxyCache } from "../../../video-editor/media/node/preview/previewProxyCache";
import { createMiniCutPageSyncRuntime } from "../../../video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import { resolveMediaBinaries } from "../../../video-editor/media/node/binaries";
import { createPcmMixCache } from "../../../video-editor/media/node/audio/pcmMixCache";
import { createNodeAudioContext } from "../../../video-editor/media/node/audio/nodeAudioContext";
import { createMediaService } from "../../../video-editor/media/node/mediaService";
import { createAudioMixController } from "../host/audioMixController";
import { createDesktopAudio, type PlaybackAudio } from "../host/desktopAudio";
import { createExportExecutor } from "../../../video-editor/hosts/desktop/exportExecutor";
import type { HostServices } from "../host/hostServices";
import { createImportExecutor } from "../../../video-editor/hosts/desktop/importExecutor";
import { createMediaRecoveryExecutor } from "../../../video-editor/hosts/desktop/mediaRecoveryExecutor";
import { createImportFromDialog, type PathPrompt } from "../host/nativeDialogs";
import { createPlaybackExecutor, timerPlaybackClock } from "../host/playbackExecutor";
import { createRuntimeRefStore } from "../../../video-editor/hosts/desktop/runtimeRefs";
import { DktWorkerStartError, spawnDktWorker } from "../host/spawnDktWorker";
import { createNodePreviewController } from "../preview/nodePreviewController";
import { preflight, StartupError } from "./preflight";

export type RealHost = {
	pageRuntime: PageSyncRuntime;
	services: HostServices;
	profileDir: string;
	/** Idempotent clean shutdown: executors, ffmpeg/ffprobe children, DKT host, LevelDB. */
	dispose(): Promise<void>;
};

export type StartRealHostOptions = {
	profileDir: string;
	exportDir: string;
	/** Native path picker (`promptForPaths` of the GPUIX renderer). */
	prompt: PathPrompt;
	/** The DKT worker died after a successful start. */
	onCrash(error: Error): void;
	/** Test hooks (automation): files imported by the "test import" control and a quit control. */
	testHooks?: { importPaths: readonly string[]; quit(): void };
	/**
	 * Sound output. `device` (default) opens the default audio device and
	 * falls back to the silent system clock when there is none; `off` never
	 * touches the audio device (tests, headless runs).
	 */
	audio?: "device" | "off";
};

const asStartupError = (error: unknown, profileDir: string): unknown => {
	if (error instanceof DktWorkerStartError && /LevelDB/.test(error.message)) {
		return new StartupError(
			"The project database could not be opened. MiniCut may already be running with this profile.",
			`Close the other MiniCut window, or set MINICUT_PROFILE_DIR to another folder (profile: ${profileDir}).`,
			error,
		);
	}
	if (error instanceof DktWorkerStartError) {
		return new StartupError(
			`The MiniCut host could not start: ${error.message}`,
			`Profile: ${profileDir}`,
			error,
		);
	}
	return error;
};

/**
 * Opens the audio output for playback, or returns null (sound off) when the
 * host runs without a device. A device that fails to open is reported once and
 * playback continues silently on the system clock.
 */
const openPlaybackAudio = async (
	mode: "device" | "off",
	mix: ReturnType<typeof createAudioMixController>,
	media: ReturnType<typeof createMediaService>,
	cacheDir: string,
): Promise<PlaybackAudio | null> => {
	if (mode === "off") return null;
	try {
		const context = await createNodeAudioContext();
		return createDesktopAudio({
			context,
			mix,
			openStream: (request) => media.streamAudioMix(request),
			cache: createPcmMixCache({
				dir: cacheDir,
				openStream: (request) => media.streamAudioMix(request),
			}),
			fallbackClock: timerPlaybackClock(),
			onError: (error) => console.error("[minicut:gpuix] audio stream failed", error),
		});
	} catch (error) {
		console.warn(
			`[minicut:gpuix] no audio output, playback is silent: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
};

/**
 * Real host composition of the GPUIX app: DKT on LevelDB in a Bun worker, the
 * page sync runtime, the asset registry, the media service and the GPUIX-side
 * executors for every effect the model requests (import, export, media
 * recovery, playback), plus the Node preview. Anything missing is a startup
 * error here, never a silent no-op.
 */
export const startRealHost = async ({
	profileDir,
	exportDir,
	prompt,
	onCrash,
	testHooks,
	audio: audioMode = "device",
}: StartRealHostOptions): Promise<RealHost> => {
	await preflight(profileDir);
	const worker = await spawnDktWorker({ profileDir, onCrash }).catch(
		(error: unknown) => {
			throw asStartupError(error, profileDir);
		},
	);
	const cleanups: Array<() => void | Promise<void>> = [];
	let disposePromise: Promise<void> | null = null;
	const dispose = (): Promise<void> => {
		disposePromise ||= (async () => {
			let firstError: unknown = null;
			for (const cleanup of cleanups.reverse()) {
				try {
					await cleanup();
				} catch (error) {
					firstError ??= error;
				}
			}
			if (firstError) throw firstError;
		})();
		return disposePromise;
	};
	// The worker is closed last, after the page and executors stopped using it.
	cleanups.push(() => worker.dispose());

	try {
		const pageRuntime = createMiniCutPageSyncRuntime({ transport: worker.transport });
		cleanups.push(() => pageRuntime.destroy());
		pageRuntime.bootstrap({ sessionKey: "minicut-gpuix-app" });

		const registry = await createNodeAssetRegistry({
			filePath: nodeAssetRegistryPathFor(worker.identity.storagePath),
		});
		cleanups.push(() => registry.flush());
		const binaries = resolveMediaBinaries();
		const media = createMediaService({ ...binaries, assetResolver: registry });
		const probe = (filePath: string) =>
			media.probe({ requestId: `probe:${crypto.randomUUID()}`, source: { path: filePath } });
		const refs = createRuntimeRefStore();

		const importer = createImportExecutor({
			page: pageRuntime,
			registry,
			refs,
			probe,
			fingerprint: (filePath) => fingerprintNodeFile(filePath),
			stat: async (filePath) => {
				const info = await stat(filePath);
				return { size: info.size, mtimeMs: info.mtimeMs };
			},
			ownerPeerId: worker.identity.peerId,
			generateId: () => crypto.randomUUID(),
			now: () => Date.now(),
		});
		const exporter = createExportExecutor({
			page: pageRuntime,
			media,
			assets: registry,
			exportDirectory: exportDir,
		});
		cleanups.push(() => exporter.dispose());
		const proxies = createPreviewProxyCache({
			dir: resolveNodePreviewProxyDir(profileDir),
			mediaService: media,
		});
		cleanups.push(() => proxies.dispose());
		const preview = createNodePreviewController({
			ffmpegPath: binaries.ffmpegPath,
			proxies,
			assets: registry,
			probe,
		});
		cleanups.push(() => preview.dispose());
		const audioMix = createAudioMixController({ assets: registry, probe });
		cleanups.push(() => audioMix.dispose());
		const playbackAudio = await openPlaybackAudio(
			audioMode,
			audioMix,
			media,
			resolveNodeAudioMixCacheDir(profileDir),
		);
		if (playbackAudio) cleanups.push(() => playbackAudio.dispose());
		const recovery = createMediaRecoveryExecutor({
			page: pageRuntime,
			registry,
			refs,
			probe,
			fingerprint: (filePath) => fingerprintNodeFile(filePath),
			onAssetsChanged: () => {
				preview.refreshAssets();
				audioMix.refreshAssets();
			},
			generateId: () => crypto.randomUUID(),
			now: () => Date.now(),
		});
		const playback = createPlaybackExecutor({
			page: pageRuntime,
			...(playbackAudio ? { audio: playbackAudio } : {}),
		});
		cleanups.push(() => playback.dispose());

		const listen = (
			fxName: `$fx_${string}`,
			handler: (payload: unknown) => unknown,
		): void => {
			const stop = pageRuntime.subscribeRuntimeTaskRequests?.(fxName, (payload) => {
				void Promise.resolve(handler(payload)).catch((error) => {
					console.error(`[minicut:gpuix] ${fxName} executor failed`, error);
				});
			});
			if (!stop) {
				throw new StartupError(
					"The page runtime cannot deliver effect requests.",
					"This is a build problem: subscribeRuntimeTaskRequests is missing.",
				);
			}
			cleanups.push(stop);
		};
		listen("$fx_handleInputFiles", (payload) => importer.handleRequest(payload));
		listen("$fx_renderExport", (payload) => exporter.handleRequest(payload));
		listen("$fx_cancelExport", (payload) => exporter.cancel(payload));
		listen("$fx_mediaRecovery", (payload) => recovery.handleRequest(payload));
		listen("$fx_applyPlaybackRun", (payload) => playback.handleRequest(payload));

		const importFromDialog = createImportFromDialog(prompt, importer);
		const services: HostServices = {
			importFromDialog,
			async relinkFromDialog(resourceId, intent) {
				const paths = await prompt({ files: true, multiple: false, prompt: "Select file" });
				const picked = paths?.[0];
				if (picked) recovery.requestRelink(resourceId, picked, intent);
			},
			exportDirectory: exportDir,
			playback: playback.snapshot,
			preview: {
				source: preview.source,
				updatePlan: (input) => {
					preview.updatePlan(input);
					audioMix.updatePlan(input);
				},
				notice: preview.notice,
			},
			...(testHooks
				? {
						testHooks: {
							importConfiguredFiles: () => {
								importer.requestImport(testHooks.importPaths);
							},
							quit: testHooks.quit,
						},
					}
				: {}),
		};

		return { pageRuntime, services, profileDir, dispose };
	} catch (error) {
		await dispose().catch(() => undefined);
		throw error;
	}
};
