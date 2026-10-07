import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import type {
	AudioMixDescriptor,
	AudioMixStreamRequest,
} from "../../contracts/audioStream";
import { createFilePcmSource } from "./filePcmSource";
import {
	createEmptyPcmSource,
	PCM_SAMPLE_RATE,
	type PcmSource,
} from "./pcmSource";

export type PcmMixCacheOptions = {
	/** Directory of the cache files; wiped on creation (never reused across runs). */
	dir: string;
	/** Opens the mix stream (the media service) for rendering the cache. */
	openStream(request: AudioMixStreamRequest): PcmSource;
	/** Frames pulled per write. Default 0.5 s. */
	renderChunkFrames?: number;
};

export type PcmMixCacheStatus = {
	/** Frames rendered so far for the prepared mix. */
	writtenFrames: number;
	complete: boolean;
	failed: boolean;
};

export interface PcmMixCache {
	/**
	 * Starts rendering the whole mix to a PCM file (replacing the previous
	 * mix's file). Idempotent for an equal descriptor.
	 */
	prepare(mix: AudioMixDescriptor): void;
	/**
	 * Reader of the prepared mix from `startSeconds`, or null when the cache
	 * does not hold that position yet (not prepared, failed, or the renderer
	 * has not got one second past it); the caller then streams directly.
	 */
	open(mix: AudioMixDescriptor, startSeconds: number): PcmSource | null;
	status(): PcmMixCacheStatus | null;
	/** Resolves when `frames` are rendered, or the render finished, failed or was cancelled first. */
	whenWritten(frames: number): Promise<void>;
	/** Resolves when the current render finished, failed or was cancelled. */
	idle(): Promise<void>;
	dispose(): Promise<void>;
}

type Render = {
	signature: string;
	file: string;
	written: number;
	complete: boolean;
	failed: boolean;
	cancelled: boolean;
	source: PcmSource | null;
	listeners: Set<() => void>;
	done: Promise<void>;
};

const signatureOf = (mix: AudioMixDescriptor): string => JSON.stringify(mix);

/**
 * Render-once PCM cache of the timeline mix. The mix is rendered through the
 * normal stream (same export mixer graph) into a raw f32 file at the speed of
 * ffmpeg, far faster than real time. A seek then reads the file at the
 * requested frame: no decoder spawn and no decode from the media start, so
 * the first samples are a disk read away. Playback can start reading while the
 * render is still running as long as it stays one second behind the renderer.
 */
export const createPcmMixCache = (options: PcmMixCacheOptions): PcmMixCache => {
	const chunkFrames = options.renderChunkFrames ?? PCM_SAMPLE_RATE / 2;
	let current: Render | null = null;
	let counter = 0;
	let disposed = false;
	const wiped = rm(options.dir, { recursive: true, force: true }).catch(
		() => undefined,
	);

	const notify = (render: Render): void => {
		for (const listener of [...render.listeners]) listener();
	};

	const renderInto = async (render: Render, source: PcmSource): Promise<void> => {
		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			await wiped;
			await mkdir(options.dir, { recursive: true });
			handle = await open(render.file, "w");
			while (!render.cancelled) {
				await source.ready(chunkFrames);
				if (render.cancelled) break;
				const chunk = source.pull(chunkFrames);
				if (chunk) {
					await handle.write(
						new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
					);
					render.written += chunk.length / 2;
					notify(render);
					continue;
				}
				if (source.error) {
					render.failed = true;
					return;
				}
				if (source.ended) break;
			}
			if (!render.cancelled) {
				render.failed = source.error !== null;
				render.complete = !render.failed;
			}
		} catch {
			render.failed = true;
		} finally {
			await render.source?.cancel().catch(() => undefined);
			await handle?.close().catch(() => undefined);
			if (render.failed || render.cancelled) {
				await rm(render.file, { force: true }).catch(() => undefined);
			}
			notify(render);
		}
	};

	const discard = (render: Render | null): void => {
		if (!render) return;
		render.cancelled = true;
		void render.source?.cancel();
		notify(render);
		render.listeners.clear();
	};

	return {
		prepare(mix) {
			if (disposed) return;
			const signature = signatureOf(mix);
			if (current?.signature === signature && !current.failed && !current.cancelled) {
				return;
			}
			discard(current);
			counter += 1;
			const render: Render = {
				signature,
				file: path.join(options.dir, `mix-${counter}.f32`),
				written: 0,
				complete: false,
				failed: false,
				cancelled: false,
				source: null,
				listeners: new Set(),
				done: Promise.resolve(),
			};
			current = render;
			// The decoder starts now; the file is set up while it fills its pipe.
			render.source = options.openStream({ ...mix, startSeconds: 0 });
			render.done = renderInto(render, render.source);
		},
		open(mix, startSeconds) {
			const render = current;
			if (!render || render.failed || render.cancelled) return null;
			if (render.signature !== signatureOf(mix)) return null;
			const startFrame = Math.max(0, Math.round(startSeconds * PCM_SAMPLE_RATE));
			if (render.complete && startFrame >= render.written) {
				return createEmptyPcmSource();
			}
			if (!render.complete && render.written < startFrame + PCM_SAMPLE_RATE) {
				return null;
			}
			return createFilePcmSource({
				path: render.file,
				startFrame,
				extent: {
					writtenFrames: () => render.written,
					complete: () => render.complete,
					subscribe(listener) {
						render.listeners.add(listener);
						return () => render.listeners.delete(listener);
					},
				},
			});
		},
		status: () =>
			current
				? {
						writtenFrames: current.written,
						complete: current.complete,
						failed: current.failed,
					}
				: null,
		whenWritten(frames) {
			const render = current;
			if (!render) return Promise.resolve();
			return new Promise<void>((resolve) => {
				const check = (): void => {
					if (render.written >= frames || render.complete || render.failed || render.cancelled) {
						render.listeners.delete(check);
						resolve();
					}
				};
				render.listeners.add(check);
				check();
			});
		},
		idle: async () => {
			await current?.done;
		},
		async dispose() {
			disposed = true;
			const render = current;
			current = null;
			discard(render);
			await render?.done;
			await wiped;
			await rm(options.dir, { recursive: true, force: true }).catch(() => undefined);
		},
	};
};
