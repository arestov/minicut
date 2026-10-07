import { stat } from "node:fs/promises";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import {
	createNodeAssetRegistry,
	nodeAssetRegistryPathFor,
} from "../../../video-editor/adapters/node/nodeAssetRegistry";
import { fingerprintNodeFile } from "../../../video-editor/adapters/node/nodeFileFingerprint";
import { resolveNodePreviewProxyDir } from "../../../video-editor/adapters/node/nodeProfileLayout";
import { createPreviewProxyCache } from "../../../video-editor/media/node/preview/previewProxyCache";
import { createMiniCutPageSyncRuntime } from "../../../video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import { resolveMediaBinaries } from "../../../video-editor/media/node/binaries";
import { createMediaService } from "../../../video-editor/media/node/mediaService";
import { createExportExecutor } from "../host/exportExecutor";
import type { HostServices } from "../host/hostServices";
import { createImportExecutor } from "../host/importExecutor";
import { createMediaRecoveryExecutor } from "../host/mediaRecoveryExecutor";
import { createImportFromDialog, type PathPrompt } from "../host/nativeDialogs";
import { createPlaybackExecutor } from "../host/playbackExecutor";
import { createResourceAssetIndex } from "../host/resourceAssetIndex";
import { createRestoreDriver } from "../host/restoreDriver";
import { createRuntimeRefStore } from "../host/runtimeRefs";
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
		const assetIndex = createResourceAssetIndex(pageRuntime);
		cleanups.push(() => assetIndex.dispose());
		const assetIdFor = (resourceId: string) => assetIndex.assetIdFor(resourceId);

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
			assetIdFor,
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
			assetIdFor,
			contentKeyFor: (resourceId) => assetIndex.contentKeyFor(resourceId),
			proxies,
			assets: registry,
			probe,
		});
		cleanups.push(() => preview.dispose());
		const recovery = createMediaRecoveryExecutor({
			page: pageRuntime,
			registry,
			refs,
			assetIdFor,
			probe,
			fingerprint: (filePath) => fingerprintNodeFile(filePath),
			onAssetsChanged: () => preview.refreshAssets(),
			generateId: () => crypto.randomUUID(),
			now: () => Date.now(),
		});
		const playback = createPlaybackExecutor({ page: pageRuntime });
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
		listen("$fx_mediaRecovery", (payload) => recovery.handleRequest(payload));
		listen("$fx_applyPlaybackRun", (payload) => playback.handleRequest(payload));

		const restore = createRestoreDriver({
			index: assetIndex,
			recovery,
			imports: importer,
			bootId: `boot:${crypto.randomUUID()}`,
		});
		cleanups.push(() => restore.dispose());
		cleanups.push(assetIndex.subscribe(() => preview.refreshAssets()));

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
				updatePlan: (input) => preview.updatePlan(input),
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
