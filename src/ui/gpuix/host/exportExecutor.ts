import path from "node:path";
import { parseExportRequest } from "../../../video-editor/app/exportRequestState";
import type { AssetLocations, AssetResolver } from "../../../video-editor/media/contracts/assets";
import type { MediaService } from "../../../video-editor/media/node/mediaService";
import type { HostPage } from "./hostTypes";

export type ExportExecutorDeps = {
	page: HostPage;
	media: Pick<MediaService, "exportPlan">;
	assets: AssetResolver;
	/** Asset id of the local file behind a resource node id (page-side projection). */
	assetIdFor(resourceId: string): string | null;
	/** Directory the exports are written to (created by the media service). */
	exportDirectory: string;
};

export type ExportExecutor = {
	/** Handler of the `$fx_renderExport` task request published by the host. */
	handleRequest(payload: unknown): void;
	/**
	 * Cancels running jobs for shutdown (kills ffmpeg, removes temp files) and
	 * resolves when they are settled. Cancelled jobs report nothing to the model.
	 */
	dispose(): Promise<void>;
};

type ExportStage = "queued" | "rendering" | "finalizing";

const safeFileId = (id: string): string =>
	id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "export";

/**
 * Export executor on the Node media service (WebM). Progress, completion and
 * errors return through the existing model actions, each event its own
 * dispatch (same delivery as web page executors); the request is consumed
 * when the job ends. Sources are resolved from the request's `resourceId`s
 * through the page-side asset index and the registry. A new request with the same queue key supersedes the running one
 * (replace-last, like the Web task facade).
 */
export const createExportExecutor = ({
	page,
	media,
	assets,
	assetIdFor,
	exportDirectory,
}: ExportExecutorDeps): ExportExecutor => {
	const running = new Map<
		string,
		{ requestId: string; cancel(): void; settled: Promise<void> }
	>();
	let disposed = false;

	const resolveAssetLocations = async (
		clipSources: ReadonlyArray<{
			id?: string;
			name?: string;
			resourceId?: string | null;
			resourceKind?: string;
		}>,
	): Promise<{ ok: true; assets: AssetLocations } | { ok: false; message: string }> => {
		const locations: AssetLocations = {};
		for (const source of clipSources) {
			if (source.resourceKind === "text") continue;
			const resourceId = source.resourceId;
			if (!resourceId) {
				return { ok: false, message: `Clip ${source.id ?? "?"} has no resource` };
			}
			if (locations[resourceId]) continue;
			const assetId = assetIdFor(resourceId);
			if (!assetId) {
				return {
					ok: false,
					message: `Source of ${source.name ?? resourceId} is not available on this device`,
				};
			}
			const resolution = await assets.resolve(assetId);
			if (!resolution.ok) {
				return {
					ok: false,
					message: `Source file of ${source.name ?? resourceId} is missing`,
				};
			}
			locations[resourceId] = resolution.location;
		}
		return { ok: true, assets: locations };
	};

	const run = async (
		queueKey: string,
		request: NonNullable<ReturnType<typeof parseExportRequest>>,
	): Promise<void> => {
		const setProgress = (
			stage: ExportStage | "done" | "error",
			progress: number,
			extra: Record<string, unknown> = {},
		): void => {
			page.dispatch(
				"setExportProgress",
				{
					id: request.id,
					range: request.range,
					stage,
					progress,
					updatedAt: Date.now(),
					initiatedBy: request.initiatedBy,
					...extra,
				},
				null,
			);
		};
		let superseded = false;
		const entry = {
			requestId: request.id,
			cancel: () => {
				superseded = true;
				job?.cancel();
			},
			settled: Promise.resolve(),
		};
		let job: ReturnType<MediaService["exportPlan"]> | null = null;
		running.set(queueKey, entry);
		const finish = (): void => {
			if (running.get(queueKey) === entry) running.delete(queueKey);
			if (!superseded) {
				page.dispatch("consumeExportRequest", { id: request.id }, null);
			}
		};

		try {
			setProgress("queued", 0);
			const resolved = await resolveAssetLocations(request.plan.clipSources);
			if (superseded) return;
			if (!resolved.ok) {
				setProgress("error", 0, { error: resolved.message });
				return;
			}
			const outputPath = path.join(
				exportDirectory,
				`minicut-${safeFileId(request.id)}.webm`,
			);
			job = media.exportPlan({
				requestId: request.id,
				plan: request.plan,
				range: request.range,
				format: "webm",
				outputPath,
				assets: resolved.assets,
			});
			let lastKey = "";
			job.onProgress((event) => {
				if (superseded) return;
				const stage: ExportStage =
					event.stage === "rendering"
						? "rendering"
						: event.stage === "finalizing"
							? "finalizing"
							: "queued";
				const percent = Math.min(99, Math.round(event.ratio * 100));
				const key = `${stage}:${percent}`;
				if (key === lastKey) return;
				lastKey = key;
				setProgress(stage, percent);
			});
			const outcome = await job.outcome;
			if (superseded || disposed) return;
			if (outcome.status === "done") {
				setProgress("done", 100, {
					fileName: path.basename(outcome.artifact.path),
					size: outcome.artifact.size,
					frameCount: outcome.artifact.frameCount,
				});
			} else if (outcome.status === "error") {
				setProgress("error", 0, { error: outcome.error.message });
			} else {
				setProgress("error", 0, { error: "Export cancelled" });
			}
		} catch (error) {
			if (!superseded && !disposed) {
				setProgress("error", 0, {
					error: error instanceof Error ? error.message : "Export failed",
				});
			}
		} finally {
			if (!disposed) finish();
			else if (running.get(queueKey) === entry) running.delete(queueKey);
		}
	};

	return {
		handleRequest(payload) {
			if (disposed) return;
			const envelope =
				payload && typeof payload === "object"
					? (payload as { request?: unknown; queueKey?: unknown })
					: null;
			const request = parseExportRequest(envelope?.request ?? payload);
			if (!request) return;
			const queueKey =
				typeof envelope?.queueKey === "string" && envelope.queueKey
					? envelope.queueKey
					: request.range.type === "clip"
						? `clip:${request.range.clipId}`
						: "project";
			running.get(queueKey)?.cancel();
			const pending = run(queueKey, request);
			const entry = running.get(queueKey);
			if (entry) entry.settled = pending;
		},
		async dispose() {
			disposed = true;
			const entries = [...running.values()];
			for (const entry of entries) entry.cancel();
			await Promise.all(entries.map((entry) => entry.settled));
		},
	};
};
