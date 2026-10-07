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
 */

export interface PreviewSource {
	/** Changes whenever the plan or the asset files change; keys the cache. */
	revision: string;
	plan: ExportPlan;
	/** Resolved file path by clip resourceId. */
	assetPaths: Record<string, string>;
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
	};

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

	const keyFor = (src: PreviewSource, index: number): string =>
		`${src.revision}|${index}|${width}x${height}`;

	const startDecode = (
		src: PreviewSource,
		timeSeconds: number,
		generation: number,
	): void => {
		counters.decodes += 1;
		const fps = planFps(src.plan, options.fps);
		const key = keyFor(src, frameIndexAt(timeSeconds, fps));
		const decode = decodePreviewFrame({
			ffmpegPath: options.ffmpegPath,
			plan: src.plan,
			assetPaths: src.assetPaths,
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
		const cached = cache.get(keyFor(src, index));
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
				return;
			}
			cancelInflight();
			cache.clear();
			source = next;
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
			const hit = cache.has(keyFor(src, frameIndexAt(timeSeconds, fps)));
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
