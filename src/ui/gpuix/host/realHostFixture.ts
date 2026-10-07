import { mkdtempSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import { createNodeAssetRegistry, nodeAssetRegistryPathFor, type NodeAssetRegistry } from "../../../video-editor/adapters/node/nodeAssetRegistry";
import { fingerprintNodeFile } from "../../../video-editor/adapters/node/nodeFileFingerprint";
import { createMiniCutPageSyncRuntime } from "../../../video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import { createMediaService } from "../../../video-editor/media/node/mediaService";
import { createScenarioDriver, type ScenarioDriver } from "../fixtures/scenarioDriver";
import { createMediaRecoveryExecutor, type MediaRecoveryExecutor } from "./mediaRecoveryExecutor";
import { createExportExecutor, type ExportExecutor } from "./exportExecutor";
import { createImportExecutor, type ImportExecutor } from "./importExecutor";
import { createRuntimeRefStore } from "./runtimeRefs";
import { spawnDktWorker, type DktWorkerHandle } from "./spawnDktWorker";

/**
 * Test composition of the real host pieces: DKT on LevelDB in a Bun worker,
 * the page sync runtime, the asset registry and the media service. Used by
 * window-free tests of the GPUIX-side executors.
 */
export type RealHostFixture = {
	profileDir: string;
	worker: DktWorkerHandle;
	page: PageSyncRuntime;
	driver: ScenarioDriver;
	registry: NodeAssetRegistry;
	media: ReturnType<typeof createMediaService>;
	refs: ReturnType<typeof createRuntimeRefStore>;
	/** Wires the import executor to the model's import effect requests. */
	attachImport(): ImportExecutor;
	/** Wires the export executor (output under <profile>/exports). */
	attachExport(): ExportExecutor;
	exportDirectory: string;
	/** Wires media recovery (also the boot restore the model schedules). */
	attachRecovery(): MediaRecoveryExecutor;
	close(): Promise<void>;
};

export const openRealHostFixture = async (
	existingProfileDir?: string,
): Promise<RealHostFixture> => {
	const profileDir =
		existingProfileDir ?? mkdtempSync(path.join(tmpdir(), "minicut-gpuix-real-"));
	const worker = await spawnDktWorker({ profileDir });
	const page = createMiniCutPageSyncRuntime({ transport: worker.transport });
	page.bootstrap({ sessionKey: "gpuix-real-host-test" });
	const driver = createScenarioDriver(page);
	const registry = await createNodeAssetRegistry({
		filePath: nodeAssetRegistryPathFor(worker.identity.storagePath),
	});
	const media = createMediaService({ assetResolver: registry });
	const refs = createRuntimeRefStore();
	const disposers: Array<() => void> = [];
	const disposeExecutors: Array<() => Promise<void>> = [];
	let closed = false;

	return {
		profileDir,
		worker,
		page,
		driver,
		registry,
		media,
		refs,
		attachImport() {
			const executor = createImportExecutor({
				page,
				registry,
				refs,
				probe: (filePath) => media.probe({ requestId: "probe", source: { path: filePath } }),
				fingerprint: (filePath) => fingerprintNodeFile(filePath),
				stat: async (filePath) => {
					const info = await stat(filePath);
					return { size: info.size, mtimeMs: info.mtimeMs };
				},
				ownerPeerId: worker.identity.peerId,
				generateId: () => crypto.randomUUID(),
				now: () => Date.now(),
			});
			const stop = page.subscribeRuntimeTaskRequests?.("$fx_handleInputFiles", (payload) => {
				void executor.handleRequest(payload);
			});
			if (stop) disposers.push(stop);
			return executor;
		},
		exportDirectory: path.join(profileDir, "exports"),
		attachRecovery() {
			const executor = createMediaRecoveryExecutor({
				page,
				registry,
				refs,
				probe: (filePath) => media.probe({ requestId: "probe", source: { path: filePath } }),
				fingerprint: (filePath) => fingerprintNodeFile(filePath),
				onAssetsChanged: () => {},
				generateId: () => crypto.randomUUID(),
				now: () => Date.now(),
			});
			const stop = page.subscribeRuntimeTaskRequests?.("$fx_mediaRecovery", (payload) => {
				void executor.handleRequest(payload);
			});
			if (stop) disposers.push(stop);
			return executor;
		},
		attachExport() {
			const executor = createExportExecutor({
				page,
				media,
				assets: registry,
				exportDirectory: path.join(profileDir, "exports"),
			});
			const stop = page.subscribeRuntimeTaskRequests?.("$fx_renderExport", (payload) => {
				executor.handleRequest(payload);
			});
			if (stop) disposers.push(stop);
			const stopCancel = page.subscribeRuntimeTaskRequests?.("$fx_cancelExport", (payload) => {
				executor.cancel(payload);
			});
			if (stopCancel) disposers.push(stopCancel);
			disposeExecutors.push(() => executor.dispose());
			return executor;
		},
		async close() {
			if (closed) return;
			closed = true;
			await Promise.all(disposeExecutors.map((dispose) => dispose()));
			for (const dispose of disposers) dispose();
			driver.destroy();
			page.destroy();
			await registry.flush();
			await worker.dispose();
			if (!existingProfileDir) rmSync(profileDir, { recursive: true, force: true });
		},
	};
};
