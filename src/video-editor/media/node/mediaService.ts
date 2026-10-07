import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AssetLocation, AssetResolver } from "../contracts/assets";
import type { MediaCapabilities } from "../contracts/capabilities";
import type { MediaExportRequest } from "../contracts/export";
import type { FileArtifact, MediaJob } from "../contracts/job";
import type { ProbeRequest, ProbeResult } from "../contracts/probe";
import type { ProxyRequest } from "../contracts/proxy";
import { type MediaBinaries, resolveMediaBinaries } from "./binaries";
import { startFfmpeg } from "./ffmpegRunner";
import {
	planFfmpegExport,
	SUPPORTED_PLAN_OPERATIONS,
	UNSUPPORTED_PLAN_OPERATIONS,
} from "./ffmpegPlanner";
import { probeFile } from "./ffprobe";
import { JobLimiter } from "./jobLimiter";
import { MediaError, toMediaErrorInfo } from "./mediaError";
import { MediaJobController } from "./mediaJob";
import { buildProxyArgs } from "./proxyPlanner";
import { runCaptured } from "./processRunner";

export interface MediaServiceOptions extends Partial<MediaBinaries> {
	assetResolver?: AssetResolver;
	/** Bounded concurrent ffmpeg jobs. Default 2. */
	maxConcurrentJobs?: number;
	/** Upper bound for one ffmpeg process. Default none. */
	jobTimeoutMs?: number;
	/** Diagnostics/test hook: called with the ffmpeg pid of each started job. */
	onProcessStart?: (pid: number) => void;
}

export interface MediaService {
	probe(request: ProbeRequest): Promise<ProbeResult>;
	exportPlan(request: MediaExportRequest): MediaJob<FileArtifact>;
	generateProxy(request: ProxyRequest): MediaJob<FileArtifact>;
	capabilities(): Promise<MediaCapabilities>;
}

interface PreparedJob {
	args: string[];
	totalSeconds: number;
}

const safeId = (value: string): string =>
	value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "job";

const removeQuietly = (file: string): Promise<void> =>
	rm(file, { force: true, maxRetries: 5, retryDelay: 50 }).catch(
		() => undefined,
	);

export const createMediaService = (
	options: MediaServiceOptions = {},
): MediaService => {
	const binaries = resolveMediaBinaries(options);
	const limiter = new JobLimiter(options.maxConcurrentJobs ?? 2);
	const inFlightRequestIds = new Set<string>();
	const inFlightOutputs = new Set<string>();
	const outputKey = (file: string): string =>
		process.platform === "win32" ? file.toLowerCase() : file;

	const resolveLocation = async (
		source: { assetId: string } | AssetLocation,
	): Promise<string> => {
		if ("path" in source) return source.path;
		if (!options.assetResolver) {
			throw new MediaError(
				"asset-not-found",
				`No asset resolver configured for asset ${source.assetId}`,
				{ assetId: source.assetId },
			);
		}
		const resolution = await options.assetResolver.resolve(source.assetId);
		if (!resolution.ok) {
			throw new MediaError(
				resolution.error.code,
				resolution.error.message,
				resolution.error.details,
			);
		}
		return resolution.location.path;
	};

	const probePath = (requestId: string, file: string, countFrames = false) =>
		probeFile(requestId, file, {
			ffprobePath: binaries.ffprobePath,
			countFrames,
		});

	/**
	 * Shared file-job lifecycle: queue -> prepare -> run ffmpeg to a temp file
	 * next to the target -> verify -> atomic rename. Temp files are removed on
	 * failure and cancellation.
	 */
	const startFileJob = (
		requestId: string,
		outputPath: string,
		prepare: (tempPath: string) => Promise<PreparedJob>,
	): MediaJob<FileArtifact> => {
		const job = new MediaJobController<FileArtifact>(requestId);
		const finalPath = path.resolve(outputPath);
		const tempPath = path.join(
			path.dirname(finalPath),
			`.${path.basename(finalPath, path.extname(finalPath))}.${safeId(requestId)}.part${path.extname(finalPath)}`,
		);
		const duplicate = inFlightRequestIds.has(requestId)
			? `requestId ${requestId} is already in flight`
			: inFlightOutputs.has(outputKey(finalPath))
				? `outputPath ${finalPath} is already in use by another job`
				: null;
		if (duplicate) {
			job.fail({ code: "invalid-request", message: duplicate });
			return job;
		}
		inFlightRequestIds.add(requestId);
		inFlightOutputs.add(outputKey(finalPath));
		const slot = limiter.acquire();
		let runHandle: ReturnType<typeof startFfmpeg> | null = null;

		job.setCancelHandler(() => {
			slot.abort();
			void runHandle?.cancel();
		});
		job.emitProgress({ stage: "queued", ratio: 0 });

		// The body returns the terminal action; it runs only after cleanup so
		// that observers of the outcome never see leftover temp files.
		const execute = async (): Promise<() => void> => {
			if (job.cancelRequested) return () => job.cancelled();
			job.emitProgress({ stage: "preparing", ratio: 0 });
			await mkdir(path.dirname(finalPath), { recursive: true });
			const prepared = await prepare(tempPath);
			if (job.cancelRequested) return () => job.cancelled();
			job.emitProgress({ stage: "rendering", ratio: 0 });
			runHandle = startFfmpeg({
				ffmpegPath: binaries.ffmpegPath,
				args: prepared.args,
				totalSeconds: prepared.totalSeconds,
				timeoutMs: options.jobTimeoutMs,
				onProgress: (ratio) => job.emitProgress({ stage: "rendering", ratio }),
			});
			if (runHandle.pid !== undefined) options.onProcessStart?.(runHandle.pid);
			// cancel() may have raced before runHandle existed.
			if (job.cancelRequested) void runHandle.cancel();
			await runHandle.finished;

			job.emitProgress({ stage: "finalizing", ratio: 0.99 });
			const info = await probePath(requestId, tempPath, true).catch(
				(error: unknown) => {
					throw new MediaError(
						"output-failed",
						"ffmpeg produced an unreadable output file",
						{ cause: toMediaErrorInfo(error) },
					);
				},
			);
			if (job.cancelRequested) return () => job.cancelled();
			try {
				await rename(tempPath, finalPath);
			} catch (error) {
				throw new MediaError(
					"output-failed",
					`Could not move output into place: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			const size = (await stat(finalPath)).size;
			return () => {
				job.emitProgress({ stage: "finalizing", ratio: 1 });
				job.done({
					path: finalPath,
					size,
					durationSeconds: info.durationSeconds,
					frameCount: info.video?.frameCount ?? 0,
				});
			};
		};

		const run = async (): Promise<void> => {
			let release: (() => void) | null = null;
			try {
				release = await slot.ready;
			} catch {
				inFlightRequestIds.delete(requestId);
				inFlightOutputs.delete(outputKey(finalPath));
				job.cancelled();
				return;
			}
			let finish: () => void;
			try {
				finish = await execute();
			} catch (error) {
				finish =
					job.cancelRequested || runHandle?.cancelled
						? () => job.cancelled()
						: () => job.fail(toMediaErrorInfo(error));
			}
			await removeQuietly(tempPath);
			release();
			inFlightRequestIds.delete(requestId);
			inFlightOutputs.delete(outputKey(finalPath));
			finish();
		};
		void run();
		return job;
	};

	return {
		probe: async (request) => {
			const file = await resolveLocation(request.source);
			return probePath(request.requestId, file);
		},

		exportPlan: (request) =>
			startFileJob(request.requestId, request.outputPath, async (tempPath) => {
				const assetPaths: Record<string, string> = {};
				const resourceIds = new Set(
					request.plan.clipSources
						.map((source) => source.resourceId)
						.filter((id): id is string => typeof id === "string" && id !== ""),
				);
				for (const resourceId of resourceIds) {
					const direct = request.assets?.[resourceId];
					if (direct) {
						assetPaths[resourceId] = direct.path;
						continue;
					}
					if (options.assetResolver) {
						assetPaths[resourceId] = await resolveLocation({
							assetId: resourceId,
						});
					}
				}
				const audioChannels: Record<string, number> = {};
				for (const source of request.plan.clipSources) {
					const id = source.resourceId;
					if (
						source.resourceKind !== "audio" ||
						!id ||
						!assetPaths[id] ||
						audioChannels[id] !== undefined
					) {
						continue;
					}
					const info = await probePath(request.requestId, assetPaths[id]);
					if (info.audio) audioChannels[id] = info.audio.channels;
				}
				const plan = planFfmpegExport({
					audioChannels,
					plan: request.plan,
					range: request.range,
					format: request.format ?? "webm",
					assetPaths,
					outputPath: tempPath,
					fps: request.fps,
					width: request.width,
					height: request.height,
				});
				// Fail early and typed when an input file is missing.
				for (const file of Object.values(assetPaths)) {
					try {
						await stat(file);
					} catch {
						throw new MediaError(
							"asset-not-found",
							`Asset file not found: ${file}`,
							{ path: file },
						);
					}
				}
				return { args: plan.args, totalSeconds: plan.durationSeconds };
			}),

		generateProxy: (request) =>
			startFileJob(request.requestId, request.outputPath, async (tempPath) => {
				const source = await resolveLocation(request.source);
				const info = await probePath(request.requestId, source);
				if (!info.video) {
					throw new MediaError("invalid-request", "Proxy source has no video", {
						path: source,
					});
				}
				return {
					args: buildProxyArgs({
						inputPath: source,
						outputPath: tempPath,
						height: request.height,
						allIntra: request.allIntra,
						gopSize: request.gopSize,
						hasAudio: info.audio !== null,
					}),
					totalSeconds: info.durationSeconds,
				};
			}),

		capabilities: async () => {
			const result = await runCaptured(binaries.ffmpegPath, ["-version"], {
				timeoutMs: 10_000,
			});
			const match = /ffmpeg version (\S+)/.exec(result.stdout);
			const encoders = await runCaptured(
				binaries.ffmpegPath,
				["-hide_banner", "-encoders"],
				{ timeoutMs: 10_000 },
			);
			const has = (name: string): boolean =>
				new RegExp(`\\s${name}\\s`).test(encoders.stdout);
			const videoCodecs = ["libvpx-vp9", "libx264"].filter(has);
			const audioCodecs = ["libopus", "aac"].filter(has);
			return {
				ffmpegVersion: match?.[1] ?? "unknown",
				formats: [
					...(has("libvpx-vp9") && has("libopus") ? (["webm"] as const) : []),
					...(has("libx264") && has("aac") ? (["mp4"] as const) : []),
				],
				videoCodecs,
				audioCodecs,
				supportedPlanOperations: SUPPORTED_PLAN_OPERATIONS,
				unsupportedPlanOperations: UNSUPPORTED_PLAN_OPERATIONS,
				maxConcurrentJobs: limiter.limit,
			};
		},
	};
};
