import { createHash } from "node:crypto";
import { readdirSync, unlinkSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { MediaError } from "../mediaError";
import type { MediaService } from "../mediaService";

/**
 * Content-addressed cache of scrub proxies (H.264, all-intra by default) on
 * disk. A proxy file is named by a hash of the source content key and the
 * proxy parameters, so it survives restarts, renames and relinks of the same
 * content, and a parameter change never reuses an old file. Generation goes
 * through `MediaService.generateProxy` (bounded jobs, atomic output).
 * Host-local executor state, like the frame cache: nothing here enters the
 * graph.
 */

export interface PreviewProxyParams {
	/** Proxy height; sources smaller than this keep their height. */
	height: number;
	/** Every frame a keyframe: a seek decodes exactly one frame. */
	allIntra: boolean;
	/** Keyframe interval when not all-intra. */
	gopSize?: number;
}

export const DEFAULT_PREVIEW_PROXY_PARAMS: PreviewProxyParams = {
	height: 540,
	allIntra: true,
};

/**
 * Bump when the proxy encoding (buildProxyArgs) changes in a way that makes
 * old files unsuitable.
 */
const PROXY_FORMAT_VERSION = "h264-v1";

export const previewProxyParamsKey = (params: PreviewProxyParams): string =>
	[
		PROXY_FORMAT_VERSION,
		`h${params.height}`,
		params.allIntra ? "intra" : `gop${params.gopSize ?? 12}`,
	].join("-");

/**
 * File name for a proxy. `contentKey` is opaque, e.g.
 * `${fingerprintVersion}/${contentFingerprint}` of the Resource.
 */
export const previewProxyFileName = (
	contentKey: string,
	params: PreviewProxyParams,
): string =>
	`${createHash("sha256")
		.update(`${contentKey}\n${previewProxyParamsKey(params)}`)
		.digest("hex")}.mp4`;

export interface PreviewProxySource {
	/** Opaque content key (fingerprint version + fingerprint). */
	contentKey: string;
	sourcePath: string;
}

export interface PreviewProxyCache {
	readonly params: PreviewProxyParams;
	/** Path of a proxy known to be complete, or null. Never touches the disk. */
	ready(contentKey: string): string | null;
	/**
	 * Resolves with the proxy path: an existing file is reused, otherwise one
	 * is generated. Concurrent calls for the same content share one job.
	 * Rejects with MediaError when generation fails; a failed or cancelled
	 * attempt is not remembered, so the next `ensure` retries (callers bound
	 * how often they ask).
	 */
	ensure(source: PreviewProxySource): Promise<string>;
	/** Drops the remembered outcome (ready or failed) of a content key. */
	forget(contentKey: string): void;
	/** Cancels running generations; their `ensure` promises reject. */
	dispose(): Promise<void>;
}

export interface PreviewProxyCacheOptions {
	dir: string;
	mediaService: Pick<MediaService, "generateProxy">;
	params?: PreviewProxyParams;
}

export const createPreviewProxyCache = (
	options: PreviewProxyCacheOptions,
): PreviewProxyCache => {
	const params = options.params ?? DEFAULT_PREVIEW_PROXY_PARAMS;
	const readyPaths = new Map<string, string>();
	const entries = new Map<string, Promise<string>>();
	const cancels = new Set<() => void>();
	let disposed = false;

	// Orphans of generations interrupted by a crash or kill: the media service
	// writes `.<name>.<job>.part.mp4` and renames on success. Best effort.
	try {
		for (const name of readdirSync(options.dir)) {
			if (name.startsWith(".") && name.includes(".part")) {
				try {
					unlinkSync(path.join(options.dir, name));
				} catch {
					// Locked or already gone: harmless, retried on next start.
				}
			}
		}
	} catch {
		// Directory does not exist yet: nothing to clean.
	}

	const fileExists = async (file: string): Promise<boolean> => {
		try {
			return (await stat(file)).size > 0;
		} catch {
			return false;
		}
	};

	const generate = async (
		source: PreviewProxySource,
		outputPath: string,
	): Promise<string> => {
		if (await fileExists(outputPath)) return outputPath;
		if (disposed) throw new MediaError("cancelled", "Proxy cache disposed");
		const job = options.mediaService.generateProxy({
			requestId: `preview-proxy-${path.basename(outputPath, ".mp4")}`,
			source: { path: source.sourcePath },
			outputPath,
			height: params.height,
			allIntra: params.allIntra,
			gopSize: params.gopSize,
		});
		const cancel = (): void => job.cancel();
		cancels.add(cancel);
		try {
			const outcome = await job.outcome;
			if (outcome.status === "done") return outcome.artifact.path;
			if (outcome.status === "cancelled") {
				throw new MediaError("cancelled", "Proxy generation cancelled");
			}
			throw new MediaError(outcome.error.code, outcome.error.message, {
				...outcome.error.details,
				sourcePath: source.sourcePath,
			});
		} finally {
			cancels.delete(cancel);
		}
	};

	return {
		params,

		ready: (contentKey) => readyPaths.get(contentKey) ?? null,

		ensure(source) {
			const existing = entries.get(source.contentKey);
			if (existing) return existing;
			const outputPath = path.join(
				options.dir,
				previewProxyFileName(source.contentKey, params),
			);
			const entry = generate(source, outputPath).then((file) => {
				if (entries.get(source.contentKey) === entry) {
					readyPaths.set(source.contentKey, file);
				}
				return file;
			});
			entry.catch(() => {
				// Forget the failure so a later request can retry.
				if (entries.get(source.contentKey) === entry) {
					entries.delete(source.contentKey);
				}
			});
			entries.set(source.contentKey, entry);
			return entry;
		},

		forget(contentKey) {
			entries.delete(contentKey);
			readyPaths.delete(contentKey);
		},

		async dispose() {
			disposed = true;
			for (const cancel of cancels) cancel();
			await Promise.allSettled([...entries.values()]);
		},
	};
};
