import path from "node:path";
import type { NodeAssetRegistry } from "../../adapters/node/nodeAssetRegistry";
import type { ProbeResult } from "../../media/contracts/probe";
import { isProjectImportFilesEffectData } from "../../models/Project/effects";
import { assetUriFor } from "./assetUri";
import {
	classifyProbe,
	type ImportedMediaKind,
	mimeForPath,
	technicalMetadataFromProbe,
} from "./hostMedia";
import { type HostPage, type RuntimeRefs, scopeFor } from "./hostTypes";

export type ImportExecutorDeps = {
	page: HostPage;
	registry: Pick<NodeAssetRegistry, "register">;
	refs: RuntimeRefs;
	probe(filePath: string): Promise<ProbeResult>;
	fingerprint(
		filePath: string,
	): Promise<{ fingerprint: string; version: string }>;
	stat(filePath: string): Promise<{ size: number; mtimeMs: number }>;
	/** Local replica id (`source.ownerPeerId`). */
	ownerPeerId: string;
	/** A file became a resource: the host may do follow-up work (preview proxy). Never throws into the import. */
	onImported?(file: {
		assetId: string;
		filePath: string;
		kind: ImportedMediaKind;
		fingerprint: { fingerprint: string; version: string };
	}): void;
	/** Resource `url` of a registered asset (a host-local attr); defaults to the registry reference. */
	assetUrl?(assetId: string): string;
	/** Ids for operations and batches; generated at this boundary, never in actions. */
	generateId(): string;
	now(): number;
};

export type ImportExecutor = {
	/**
	 * Stages picked paths without telling the model: returns the batch id a
	 * dispatch of `requestImportFiles` carries. Paths stay in this process.
	 */
	stage(paths: readonly string[]): string | null;
	/**
	 * Stages picked paths and asks the model to import them: returns the batch
	 * id the model carries in its effect request.
	 */
	requestImport(paths: readonly string[]): string | null;
	/** Handler of the `$fx_handleInputFiles` task request published by the host. */
	handleRequest(payload: unknown): Promise<void>;
};

/**
 * Native import executor. Dialog paths -> asset registry -> ffprobe ->
 * existing import actions. Each file enters DKT exactly once through
 * `importResource` (Project creates the Resource and its recovery task);
 * progress and errors are their own `setActiveProjectImportProgress`
 * dispatches (same delivery as web page executors). `File`/paths never enter
 * the graph: only the asset id (`sourceRef`) and serializable metadata.
 */
export const createImportExecutor = (deps: ImportExecutorDeps): ImportExecutor => {
	const { page, refs } = deps;
	const startedBatches = new Set<string>();

	const progress = (
		taskId: string,
		stage: "processing" | "done" | "error",
		processed: number,
		total: number,
		error?: string,
	): void => {
		page.dispatch(
			"setActiveProjectImportProgress",
			{ taskId, stage, processed, total, ...(error ? { error } : {}) },
			page.getRootScope(),
		);
	};

	const importOne = async (
		projectId: string,
		batchId: string,
		filePath: string,
		addToTimelineWhenEmpty: boolean,
	): Promise<void> => {
		const info = await deps.probe(filePath);
		const kind = classifyProbe(info);
		if (!kind) throw new Error("not a video, audio or image file");
		const [asset, fingerprint, file] = await Promise.all([
			deps.registry.register(filePath),
			deps.fingerprint(filePath),
			deps.stat(filePath),
		]);
		const original = technicalMetadataFromProbe(info, kind);
		const name = path.basename(filePath);
		const now = deps.now();
		// The recovery task of this import finds the asset through this ref.
		const runtimeHandleId = refs.put({ assetId: asset.assetId });
		await page.dispatchAndWait(
			"importResource",
			{
				name,
				kind,
				url: (deps.assetUrl ?? assetUriFor)(asset.assetId),
				mime: mimeForPath(filePath),
				duration: original.duration,
				width: original.width,
				height: original.height,
				size: file.size,
				lastModified: Math.round(file.mtimeMs),
				addToTimelineWhenEmpty,
				// `local-asset`: file registered in the host asset registry (M2).
				sourceKind: "local-asset",
				sourceRef: asset.assetId,
				source: { kind: "local", ownerPeerId: deps.ownerPeerId },
				status: "ready",
				data: {
					status: "ready",
					chunkSize: 1024 * 1024,
					chunks: {},
					ranges: { loaded: [[0, file.size]], requested: [] },
					loadedBytes: file.size,
				},
				assetStorageKind: "linked",
				assetRef: null,
				contentFingerprint: fingerprint.fingerprint,
				fingerprintVersion: fingerprint.version,
				localMediaStatus: "unknown",
				operationId: deps.generateId(),
				attemptId: deps.generateId(),
				bootId: `import:${batchId}`,
				recoveryKind: "import",
				intent: "restore",
				runtimeHandleId,
				original,
				requiredSourceEnd: original.duration,
				originalFingerprint: fingerprint.fingerprint,
				createdAt: now,
				updatedAt: now,
			},
			scopeFor(projectId),
		);
		try {
			deps.onImported?.({
				assetId: asset.assetId,
				filePath,
				kind,
				fingerprint,
			});
		} catch (error) {
			console.error("[minicut:import] follow-up after import failed", error);
		}
	};

	const stage = (paths: readonly string[]): string | null => {
		if (paths.length === 0) return null;
		const batchId = `import:${deps.generateId()}`;
		return refs.put({ batchId, paths: [...paths] });
	};

	return {
		stage,

		requestImport(paths) {
			const runtimeHandleId = stage(paths);
			if (runtimeHandleId === null) return null;
			page.dispatch(
				"requestImportFiles",
				{ inputBatchHandleId: runtimeHandleId },
				page.getRootScope(),
			);
			return runtimeHandleId;
		},

		async handleRequest(payload) {
			if (!isProjectImportFilesEffectData(payload)) return;
			const { projectId, inputBatchHandleId } = payload;
			if (startedBatches.has(inputBatchHandleId)) return;
			startedBatches.add(inputBatchHandleId);
			const staged = refs.consume(inputBatchHandleId) as {
				batchId: string;
				paths: string[];
			} | null;
			if (!staged || !Array.isArray(staged.paths) || staged.paths.length === 0) {
				return;
			}
			const total = staged.paths.length;
			const addToTimelineWhenEmpty = payload.addToTimelineWhenEmpty !== false;
			let processed = 0;
			const failures: string[] = [];
			progress(inputBatchHandleId, "processing", processed, total);
			for (const filePath of staged.paths) {
				try {
					await importOne(
						projectId,
						staged.batchId,
						filePath,
						addToTimelineWhenEmpty,
					);
				} catch (error) {
					const name = path.basename(filePath);
					failures.push(
						`${name}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				processed += 1;
				if (processed < total) {
					progress(inputBatchHandleId, "processing", processed, total);
				}
			}
			if (failures.length > 0) {
				progress(
					inputBatchHandleId,
					"error",
					processed,
					total,
					failures.join("; "),
				);
				return;
			}
			progress(inputBatchHandleId, "done", processed, total);
		},
	};
};
