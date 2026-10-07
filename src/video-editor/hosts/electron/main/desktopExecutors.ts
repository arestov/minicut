import { stat } from "node:fs/promises";
import type { NodeAssetRegistry } from "../../../adapters/node/nodeAssetRegistry";
import type { DesktopMediaService } from "../../../media/node/rpc/mediaServiceClient";
import { createExportExecutor, type ExportExecutor } from "../../desktop/exportExecutor";
import { type HostPage, scopeFor } from "../../desktop/hostTypes";
import { createImportExecutor, type ImportExecutor } from "../../desktop/importExecutor";
import { createMediaRecoveryExecutor } from "../../desktop/mediaRecoveryExecutor";
import { createRuntimeRefStore } from "../../desktop/runtimeRefs";
import type { PreviewProxyCache } from "../../../media/node/preview/previewProxyCache";
import type { DesktopEffectSink } from "./createDesktopEffectInterfaces";
import type { HostAction } from "./windowConnector";

/** A connected window as the executors use it: its session root and a way to act as it. */
export type ExecutorSession = {
	/** `_node_id` of the session root; null until the window has bootstrapped. */
	rootNodeId: string | null;
	dispatch(action: HostAction): void;
	dispatchAndWait(action: HostAction): Promise<void>;
};

/** Host-local state of the scrub proxy of an imported video; never enters the graph. */
export type PreviewProxyStatus =
	| { state: "generating" }
	| { state: "ready"; path: string }
	| { state: "failed"; message: string };

export type DesktopExecutorsOptions = {
	/** Live windows; looked up at every dispatch, so a closed window is never written to. */
	getSessions(): readonly ExecutorSession[];
	media: DesktopMediaService;
	registry: NodeAssetRegistry;
	/** Scrub proxies are generated here for imported videos, as jobs of the media service. */
	proxies: Pick<PreviewProxyCache, "ensure">;
	/** The proxy of an asset changed state (generation started, finished or failed). */
	onProxyChanged?(assetId: string, status: PreviewProxyStatus): void;
	/** Directory exports are written to. */
	exportDirectory: string;
	/** Local replica id (`source.ownerPeerId`). */
	ownerPeerId: string;
	/** Resource `url` the renderer can play for an asset id (host-local attr). */
	assetUrl(assetId: string): string;
	generateId(): string;
	now(): number;
	/** A request had no owner (its window is gone or never staged the batch). */
	onDropped(fxName: string, reason: string): void;
	/** An executor failed outside the model's own error reporting. */
	onFailed(fxName: string, error: unknown): void;
};

export type DesktopExecutors = DesktopEffectSink & {
	/** Proxy state of an imported video asset, or null when none was requested. */
	previewProxy(assetId: string): PreviewProxyStatus | null;
	/** Path of the finished proxy of an asset, or null. */
	previewProxyPath(assetId: string): string | null;
	/**
	 * Stages picked paths of one window's import. The window dispatches
	 * `requestImportFiles` with the returned batch id; the model's import
	 * effect then reaches that window's executor, which reports progress to
	 * that window's session root.
	 */
	stageImport(ownerRootNodeId: string, paths: readonly string[]): string | null;
	/** Drops executors of session roots that are no longer connected; running exports of those roots are cancelled. */
	retainRoots(liveRootNodeIds: ReadonlySet<string>): Promise<void>;
	dispose(): Promise<void>;
};

type RootExecutors = {
	importer: ImportExecutor;
	exporter: ExportExecutor;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

/**
 * The executors of configuration B in the main process. Windows are views of
 * the one runtime, so each session root (window) gets its own import and
 * export executor: progress, completion and queue keys never cross windows.
 * They act as the window's own session, over its own runtime connection (the
 * host adds no session of its own). Media recovery targets explicit task and
 * resource nodes, so one shared executor serves all windows and the boot
 * restore. Everything slow runs in the media service process; the executors
 * only dispatch the model's existing actions, one dispatch per event.
 */
export const createDesktopExecutors = ({
	getSessions,
	media,
	registry,
	proxies,
	onProxyChanged,
	exportDirectory,
	ownerPeerId,
	assetUrl,
	generateId,
	now,
	onDropped,
	onFailed,
}: DesktopExecutorsOptions): DesktopExecutors => {
	const refs = createRuntimeRefStore();
	const probe = (filePath: string) =>
		media.probe({ requestId: `probe:${generateId()}`, source: { path: filePath } });
	const fingerprint = (filePath: string) => media.fingerprint(filePath);
	const byRoot = new Map<string, RootExecutors>();
	/** Owner session root of each staged import batch (handle ids are unique in `refs`). */
	const batchOwners = new Map<string, string>();
	let disposed = false;
	const proxyStatus = new Map<string, PreviewProxyStatus>();

	const setProxyStatus = (assetId: string, status: PreviewProxyStatus): void => {
		proxyStatus.set(assetId, status);
		onProxyChanged?.(assetId, status);
	};

	/** The scrub proxy of a just-imported video: a media service job, tracked host-side. */
	const requestProxy = (file: {
		assetId: string;
		filePath: string;
		kind: string;
		fingerprint: { fingerprint: string; version: string };
	}): void => {
		if (file.kind !== "video" || disposed) return;
		setProxyStatus(file.assetId, { state: "generating" });
		proxies
			.ensure({
				contentKey: `${file.fingerprint.version}/${file.fingerprint.fingerprint}`,
				sourcePath: file.filePath,
			})
			.then(
				(proxyPath) => setProxyStatus(file.assetId, { state: "ready", path: proxyPath }),
				(error: unknown) => {
					// A disposed cache cancels its jobs on shutdown; that is not a failure.
					if (disposed) return;
					setProxyStatus(file.assetId, {
						state: "failed",
						message: error instanceof Error ? error.message : String(error),
					});
				},
			);
	};

	const sessionOf = (rootNodeId: string): ExecutorSession | null =>
		getSessions().find((session) => session.rootNodeId === rootNodeId) ?? null;
	const isLiveRoot = (rootNodeId: string): boolean => sessionOf(rootNodeId) !== null;

	const gone = (rootNodeId: string): Error =>
		new Error(`The window of session ${rootNodeId} is gone`);

	/** Dispatches as one window's session; a missing window is the end of that task. */
	const pageForRoot = (rootNodeId: string): HostPage => {
		const root = scopeFor(rootNodeId);
		return {
			dispatch(actionName, payload, scope) {
				sessionOf(rootNodeId)?.dispatch({
					actionName,
					payload,
					scopeNodeId: scope?._nodeId ?? rootNodeId,
				});
			},
			dispatchAndWait(actionName, payload, scope) {
				const session = sessionOf(rootNodeId);
				if (!session) return Promise.reject(gone(rootNodeId));
				return session.dispatchAndWait({
					actionName,
					payload,
					scopeNodeId: scope?._nodeId ?? rootNodeId,
				});
			},
			getRootScope: () => root,
		};
	};

	/**
	 * Dispatches through any live window: for work addressed to explicit
	 * nodes (media recovery tasks and resources), which any session may reach.
	 */
	const sharedPage: HostPage = {
		dispatch(actionName, payload, scope) {
			const session = getSessions().find((candidate) => candidate.rootNodeId !== null);
			if (!session || !scope) return;
			session.dispatch({ actionName, payload, scopeNodeId: scope._nodeId });
		},
		dispatchAndWait(actionName, payload, scope) {
			const session = getSessions().find((candidate) => candidate.rootNodeId !== null);
			if (!session || !scope) return Promise.reject(new Error("No window is connected"));
			return session.dispatchAndWait({ actionName, payload, scopeNodeId: scope._nodeId });
		},
		getRootScope: () => null,
	};

	const forRoot = (rootNodeId: string): RootExecutors => {
		let entry = byRoot.get(rootNodeId);
		if (!entry) {
			const rootPage = pageForRoot(rootNodeId);
			entry = {
				importer: createImportExecutor({
					page: rootPage,
					registry,
					refs,
					probe,
					fingerprint,
					stat: async (filePath) => {
						const info = await stat(filePath);
						return { size: info.size, mtimeMs: info.mtimeMs };
					},
					ownerPeerId,
					assetUrl,
					onImported: requestProxy,
					generateId,
					now,
				}),
				exporter: createExportExecutor({
					page: rootPage,
					media,
					assets: registry,
					exportDirectory,
				}),
			};
			byRoot.set(rootNodeId, entry);
		}
		return entry;
	};

	const recovery = createMediaRecoveryExecutor({
		page: sharedPage,
		registry,
		refs,
		probe,
		fingerprint,
		onAssetsChanged: () => undefined,
		assetUrl,
		generateId,
		now,
	});

	/** Runs an executor step; its failure is reported, never thrown into the runtime. */
	const run = (fxName: string, step: () => unknown): void => {
		if (disposed) return;
		void Promise.resolve()
			.then(step)
			.catch((error: unknown) => onFailed(fxName, error));
	};

	return {
		previewProxy: (assetId) => proxyStatus.get(assetId) ?? null,
		previewProxyPath(assetId) {
			const status = proxyStatus.get(assetId);
			return status?.state === "ready" ? status.path : null;
		},
		requestImportFiles(payload) {
			run("$fx_handleInputFiles", () => {
				const batchId = asRecord(payload)?.inputBatchHandleId;
				const owner = typeof batchId === "string" ? batchOwners.get(batchId) : undefined;
				if (typeof batchId === "string") batchOwners.delete(batchId);
				if (!owner) {
					onDropped("$fx_handleInputFiles", "no window staged this import batch");
					return;
				}
				if (!isLiveRoot(owner)) {
					onDropped("$fx_handleInputFiles", "the window that staged this import is gone");
					return;
				}
				return forRoot(owner).importer.handleRequest(payload);
			});
		},
		requestExport(payload) {
			run("$fx_renderExport", () => {
				const envelope = asRecord(payload);
				const initiatedBy = asRecord(envelope?.request ?? payload)?.initiatedBy;
				if (typeof initiatedBy !== "string" || !initiatedBy) {
					onDropped("$fx_renderExport", "the export request names no session");
					return;
				}
				if (!isLiveRoot(initiatedBy)) {
					onDropped("$fx_renderExport", "the window that started this export is gone");
					return;
				}
				forRoot(initiatedBy).exporter.handleRequest(payload);
			});
		},
		cancelExport(payload) {
			run("$fx_cancelExport", () => {
				const initiatedBy = asRecord(payload)?.initiatedBy;
				const entry = typeof initiatedBy === "string" ? byRoot.get(initiatedBy) : undefined;
				// Only the window that started an export can cancel it.
				entry?.exporter.cancel(payload);
			});
		},
		requestMediaRecovery(payload) {
			run("$fx_mediaRecovery", () => recovery.handleRequest(payload));
		},
		stageImport(ownerRootNodeId, paths) {
			const batchId = forRoot(ownerRootNodeId).importer.stage(paths);
			if (batchId !== null) batchOwners.set(batchId, ownerRootNodeId);
			return batchId;
		},
		async retainRoots(live) {
			for (const [rootNodeId, entry] of [...byRoot]) {
				if (live.has(rootNodeId)) continue;
				byRoot.delete(rootNodeId);
				for (const [batchId, owner] of [...batchOwners]) {
					if (owner === rootNodeId) {
						batchOwners.delete(batchId);
						refs.delete(batchId);
					}
				}
				await entry.exporter.dispose();
			}
		},
		async dispose() {
			disposed = true;
			const entries = [...byRoot.values()];
			byRoot.clear();
			await Promise.all(entries.map((entry) => entry.exporter.dispose()));
		},
	};
};
