import type { ExportPlan } from "../../../render/renderPlan";
import { MediaError } from "../mediaError";
import { createFrameCache } from "./frameCache";
import { createFramePool, frameFromPoolBuffer } from "./framePool";
import {
	decodePreviewFrame,
	frameIndexAt,
	frameTimeAt,
	planFps,
} from "./previewDecoder";
import type { PreviewProxyCache } from "./previewProxyCache";
import type { ProducedPreviewFrame } from "./previewTypes";

/**
 * Preview frame producer: one frame per request, newest generation wins.
 * A single-frame decode is never cancelled by a newer request: at most one
 * request waits behind it (a newer one overwrites it, counted as `coalesced`)
 * and starts when the decode finishes, so a scrub keeps producing frames.
 * Decodes are cancelled only on a source revision change or dispose. Recently
 * decoded frames are served from a small LRU keyed by (source revision, frame
 * index, size), immediately and independently of a running decode.
 * Transport-agnostic: frames are delivered synchronously to the registered
 * listener, which owns them until `release()`.
 *
 * Scrub proxies: with a proxy cache, every video resource with a content key
 * gets a proxy generated lazily when the source is set. A decode reads the
 * proxy of each resource whose proxy is ready and the original otherwise;
 * the plan (timing, trim, fit) is the same, only the input file differs.
 * Cached frames are keyed by which resources were read from proxies.
 */

export interface PreviewSource {
	/** Changes whenever the plan or the asset files change; keys the cache. */
	revision: string;
	plan: ExportPlan;
	/** Resolved file path by clip resourceId. */
	assetPaths: Record<string, string>;
	/**
	 * Probed frame rate per video resource. Needed for export-identical frame
	 * selection with sub-frame in-points.
	 */
	sourceFps?: Record<string, number>;
	/**
	 * Content key by resourceId (Resource fingerprint version + fingerprint).
	 * Resources without one are always decoded from the original.
	 */
	contentKeys?: Record<string, string>;
}

export interface PreviewProducerOptions {
	ffmpegPath: string;
	/** Preview bitmap size in pixels; even integers. */
	width: number;
	height: number;
	fps?: number;
	streamId?: string;
	/** Max pixel buffers that exist for delivered frames. Default 4. */
	poolCapacity?: number;
	/** Max cached frames (each width*height*4 bytes). Default 8. */
	cacheCapacity?: number;
	/** Test/diagnostic hook: called with the pid of every spawned decoder. */
	onProcessStart?: (pid: number) => void;
	/**
	 * Scrub proxy cache. Ignored when its proxy height is below the preview
	 * height (the proxy would be upscaled).
	 */
	proxies?: PreviewProxyCache;
}

export interface PreviewProducerStats {
	requests: number;
	cacheHits: number;
	decodes: number;
	/** Decodes killed by a source change or dispose. */
	cancelled: number;
	/** Requests that replaced a still-waiting older request. */
	coalesced: number;
	/** Requests ignored because a newer generation was already requested. */
	staleRequests: number;
	/** Frames not delivered because the consumer held every pool buffer. */
	droppedExhausted: number;
	/** Frames passed to the listener. */
	delivered: number;
	failed: number;
	/** Decodes that read at least one input from a proxy. */
	proxyDecodes: number;
	/** Contents whose proxy generation failed (they stay on originals). */
	proxyFailures: number;
	cacheSize: number;
	poolAllocated: number;
	poolOutstanding: number;
}

export interface PreviewProducer {
	setSource(source: PreviewSource): void;
	/**
	 * Asks for the frame at `timeSeconds` for `generation`. Generations must
	 * increase; a request not newer than the latest one is ignored. A frame
	 * may be delivered before this call returns (cache hit).
	 */
	request(timeSeconds: number, generation: number): void;
	/** The single frame sink; it owns delivered frames. Returns unsubscribe. */
	onFrame(listener: (frame: ProducedPreviewFrame) => void): () => void;
	onError(
		listener: (error: MediaError, generation: number) => void,
	): () => void;
	stats(): PreviewProducerStats;
	/** Resolves when no decode process is running and nothing is pending. */
	idle(): Promise<void>;
	/** Cancels everything, clears the cache and stops delivering. */
	dispose(): Promise<void>;
}

interface PendingRequest {
	timeSeconds: number;
	generation: number;
}

interface Inflight {
	cancel(): Promise<void>;
	done: Promise<void>;
}

export const createPreviewProducer = (
	options: PreviewProducerOptions,
): PreviewProducer => {
	const { width, height } = options;
	const frameBytes = width * height * 4;
	const streamId = options.streamId ?? "preview";
	const pool = createFramePool({
		byteLength: frameBytes,
		capacity: options.poolCapacity ?? 4,
	});
	const cache = createFrameCache({ capacity: options.cacheCapacity ?? 8 });

	let source: PreviewSource | null = null;
	let latestGeneration = Number.NEGATIVE_INFINITY;
	let disposed = false;
	let frameListener: ((frame: ProducedPreviewFrame) => void) | null = null;
	let errorListener: ((error: MediaError, generation: number) => void) | null =
		null;
	let inflight: Inflight | null = null;
	let pending: PendingRequest | null = null;
	const killed = new Set<Promise<unknown>>();
	const counters = {
		requests: 0,
		cacheHits: 0,
		decodes: 0,
		cancelled: 0,
		coalesced: 0,
		staleRequests: 0,
		droppedExhausted: 0,
		delivered: 0,
		failed: 0,
		proxyDecodes: 0,
	};
	const failedProxyKeys = new Set<string>();
	/** Content key -> revision in which its generation last failed. */
	const failedInRevision = new Map<string, string>();
	const proxies =
		options.proxies && options.proxies.params.height >= height
			? options.proxies
			: null;

	const deliver = (frame: ProducedPreviewFrame): void => {
		if (disposed || !frameListener) {
			frame.release();
			return;
		}
		counters.delivered += 1;
		frameListener(frame);
	};

	const cancelInflight = (): void => {
		pending = null;
		if (!inflight) return;
		counters.cancelled += 1;
		const cancelling = inflight.cancel();
		killed.add(cancelling);
		void cancelling.finally(() => killed.delete(cancelling));
		inflight = null;
	};

	/** Video resources whose proxy may be used (video kind + content key). */
	const proxyCandidates = (src: PreviewSource): string[] => {
		if (!proxies || !src.contentKeys) return [];
		const ids = new Set<string>();
		for (const clip of src.plan.clipSources) {
			if (clip.resourceKind !== "video") continue;
			const id = clip.resourceId ?? clip.id;
			if (src.contentKeys[id] && src.assetPaths[id]) ids.add(id);
		}
		return [...ids].sort();
	};

	/** Input paths for a decode now, and which resources come from proxies. */
	const inputsFor = (
		src: PreviewSource,
	): { assetPaths: Record<string, string>; proxied: string } => {
		if (!proxies || !src.contentKeys) {
			return { assetPaths: src.assetPaths, proxied: "" };
		}
		const assetPaths = { ...src.assetPaths };
		const used: string[] = [];
		for (const id of proxyCandidates(src)) {
			const proxyPath = proxies.ready(src.contentKeys[id]);
			if (!proxyPath) continue;
			assetPaths[id] = proxyPath;
			used.push(id);
		}
		return { assetPaths, proxied: used.join(",") };
	};

	const requestProxies = (src: PreviewSource): void => {
		if (!proxies || !src.contentKeys) return;
		for (const id of proxyCandidates(src)) {
			const contentKey = src.contentKeys[id];
			// One attempt per source revision: a failure is retried only when
			// the revision changes.
			if (failedInRevision.get(contentKey) === src.revision) continue;
			proxies
				.ensure({ contentKey, sourcePath: src.assetPaths[id] })
				.then(() => {
					failedProxyKeys.delete(contentKey);
				})
				.catch((error: unknown) => {
					if (disposed) return;
					if (error instanceof MediaError && error.code === "cancelled") return;
					failedProxyKeys.add(contentKey);
					failedInRevision.set(contentKey, src.revision);
				});
		}
	};

	const keyFor = (src: PreviewSource, index: number, proxied: string): string =>
		`${src.revision}|${proxied}|${index}|${width}x${height}`;

	const startDecode = (
		src: PreviewSource,
		timeSeconds: number,
		generation: number,
	): void => {
		counters.decodes += 1;
		const fps = planFps(src.plan, options.fps);
		const inputs = inputsFor(src);
		if (inputs.proxied) counters.proxyDecodes += 1;
		const key = keyFor(src, frameIndexAt(timeSeconds, fps), inputs.proxied);
		const decode = decodePreviewFrame({
			ffmpegPath: options.ffmpegPath,
			plan: src.plan,
			assetPaths: inputs.assetPaths,
			sourceFps: src.sourceFps,
			width,
			height,
			fps: options.fps,
			timeSeconds,
			generation,
			streamId,
			pool,
		});
		if (decode.pid !== undefined) options.onProcessStart?.(decode.pid);
		const current: Inflight = {
			cancel: decode.cancel,
			done: Promise.resolve(),
		};
		inflight = current;
		const finish = (): void => {
			if (inflight === current) inflight = null;
			const next = pending;
			pending = null;
			if (next && !disposed && source) serve(source, next);
		};
		current.done = decode.result.then(
			async (frame) => {
				if (inflight !== current) {
					// Cancelled (source change or dispose): nothing to deliver.
					frame?.release();
					return;
				}
				if (frame) {
					cache.set(key, frame.pixels);
					deliver(frame);
				} else {
					const outcome = await decode.outcome;
					if (outcome.status === "done" && outcome.dropped > 0) {
						counters.droppedExhausted += 1;
					}
				}
				finish();
			},
			(error: unknown) => {
				if (inflight !== current) return;
				counters.failed += 1;
				errorListener?.(
					error instanceof MediaError
						? error
						: new MediaError("process-failed", String(error)),
					generation,
				);
				finish();
			},
		);
	};

	/** Serves from the cache or starts a decode (no decode may be running). */
	const serve = (src: PreviewSource, request: PendingRequest): void => {
		const fps = planFps(src.plan, options.fps);
		const index = frameIndexAt(request.timeSeconds, fps);
		const cached = cache.get(keyFor(src, index, inputsFor(src).proxied));
		if (!cached) {
			startDecode(src, request.timeSeconds, request.generation);
			return;
		}
		counters.cacheHits += 1;
		const buffer = pool.acquire();
		if (!buffer) {
			counters.droppedExhausted += 1; // consumer holds every buffer: never block
			return;
		}
		buffer.set(cached);
		deliver(
			frameFromPoolBuffer(pool, buffer, {
				width,
				height,
				generation: request.generation,
				streamId,
				sequence: 0,
				ptsSeconds: frameTimeAt(index, fps),
			}),
		);
	};

	return {
		setSource(next) {
			if (disposed) return;
			if (source && source.revision === next.revision) {
				source = next;
				requestProxies(next);
				return;
			}
			cancelInflight();
			cache.clear();
			source = next;
			requestProxies(next);
		},

		request(timeSeconds, generation) {
			if (disposed) return;
			counters.requests += 1;
			if (generation <= latestGeneration) {
				counters.staleRequests += 1;
				return;
			}
			latestGeneration = generation;
			const src = source;
			if (!src) {
				errorListener?.(
					new MediaError("invalid-request", "Preview source is not set"),
					generation,
				);
				return;
			}
			const request = { timeSeconds, generation };
			const fps = planFps(src.plan, options.fps);
			const hit = cache.has(
				keyFor(src, frameIndexAt(timeSeconds, fps), inputsFor(src).proxied),
			);
			if (hit) {
				// A hit is served at once, independently of a running decode, and
				// supersedes an older waiting request.
				pending = null;
				serve(src, request);
			} else if (inflight) {
				if (pending) counters.coalesced += 1;
				pending = request;
			} else {
				serve(src, request);
			}
		},

		onFrame(listener) {
			frameListener = listener;
			return () => {
				if (frameListener === listener) frameListener = null;
			};
		},

		onError(listener) {
			errorListener = listener;
			return () => {
				if (errorListener === listener) errorListener = null;
			};
		},

		stats: () => ({
			...counters,
			proxyFailures: failedProxyKeys.size,
			cacheSize: cache.size,
			poolAllocated: pool.allocated,
			poolOutstanding: pool.outstanding,
		}),

		async idle() {
			while (inflight || killed.size > 0) {
				await Promise.allSettled([
					...(inflight ? [inflight.done] : []),
					...killed,
				]);
			}
		},

		async dispose() {
			disposed = true;
			cancelInflight();
			cache.clear();
			frameListener = null;
			errorListener = null;
			while (killed.size > 0) await Promise.allSettled([...killed]);
		},
	};
};
