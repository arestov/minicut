import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	AudioMixDescriptor,
	AudioMixStreamRequest,
} from "../../contracts/audioStream";
import { MediaError } from "../mediaError";
import { createPcmBuffer } from "./pcmBuffer";
import { createPcmMixCache } from "./pcmMixCache";
import { PCM_SAMPLE_RATE, type PcmSource } from "./pcmSource";

const mixOf = (name: string): AudioMixDescriptor => ({
	plan: {
		projectId: name,
		fps: 30,
		width: 2,
		height: 2,
		duration: 10,
		clipSources: [],
	},
	assets: {},
	audioChannels: {},
	silentAudioResources: [],
});

/** A producer the test drives: frames are released explicitly, left sample = frame index. */
const controllableSource = () => {
	const buffer = createPcmBuffer();
	let produced = 0;
	let finished = false;
	let cancelled = false;
	let failure: Error | null = null;
	let waiters: Array<{ frames: number; resolve: () => void }> = [];
	const settle = (): void => {
		const rest: typeof waiters = [];
		for (const waiter of waiters) {
			if (finished || cancelled || failure || buffer.frames >= waiter.frames) {
				waiter.resolve();
			} else {
				rest.push(waiter);
			}
		}
		waiters = rest;
	};
	const source: PcmSource = {
		get bufferedFrames() {
			return buffer.frames;
		},
		get ended() {
			return (finished || failure !== null) && buffer.frames === 0;
		},
		get error() {
			return failure;
		},
		pull(count) {
			if (buffer.frames >= count) return buffer.take(count);
			if (finished && buffer.frames > 0) return buffer.take(buffer.frames);
			return null;
		},
		skip: (count) => {
			const dropped = Math.min(count, buffer.frames);
			if (dropped > 0) buffer.take(dropped);
			return dropped;
		},
		ready: (count) =>
			new Promise<void>((resolve) => {
				waiters.push({ frames: count, resolve });
				settle();
			}),
		cancel: () => {
			cancelled = true;
			settle();
			return Promise.resolve();
		},
	};
	return {
		source,
		release(frames: number) {
			const data = new Float32Array(frames * 2);
			for (let i = 0; i < frames; i += 1) {
				data[2 * i] = produced + i;
				data[2 * i + 1] = -(produced + i);
			}
			produced += frames;
			buffer.push(new Uint8Array(data.buffer));
			settle();
		},
		finish() {
			finished = true;
			settle();
		},
		fail(error: Error) {
			failure = error;
			settle();
		},
		cancelled: () => cancelled,
	};
};

describe("pcm mix cache", () => {
	let dir: string;
	beforeEach(async () => {
		dir = path.join(
			await mkdtemp(path.join(os.tmpdir(), "minicut-mixcache-")),
			"audio-mix",
		);
	});
	afterEach(async () => {
		await rm(path.dirname(dir), { recursive: true, force: true });
	});

	const setup = () => {
		const producers: Array<ReturnType<typeof controllableSource>> = [];
		const requests: AudioMixStreamRequest[] = [];
		const cache = createPcmMixCache({
			dir,
			renderChunkFrames: 4800,
			openStream: (request) => {
				requests.push(request);
				const producer = controllableSource();
				producers.push(producer);
				return producer.source;
			},
		});
		return { cache, producers, requests };
	};

	const readAll = async (source: PcmSource): Promise<Float32Array> => {
		const parts: Float32Array[] = [];
		while (!source.ended) {
			await source.ready(4800);
			const part = source.pull(4800);
			if (part) parts.push(part);
		}
		const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
		let offset = 0;
		for (const part of parts) {
			all.set(part, offset);
			offset += part.length;
		}
		return all;
	};

	it("renders the whole mix from 0 and serves any start from the file", async () => {
		const { cache, producers, requests } = setup();
		const mix = mixOf("a");
		cache.prepare(mix);
		const total = PCM_SAMPLE_RATE * 4;
		producers[0]?.release(total);
		producers[0]?.finish();
		await cache.idle();

		expect(requests).toEqual([{ ...mix, startSeconds: 0 }]);
		expect(cache.status()).toEqual({
			writtenFrames: total,
			complete: true,
			failed: false,
		});
		const reader = cache.open(mix, 1.5) as PcmSource;
		const samples = await readAll(reader);
		const startFrame = Math.round(1.5 * PCM_SAMPLE_RATE);
		expect(samples.length / 2).toBe(total - startFrame);
		expect(samples[0]).toBe(startFrame);
		expect(samples[samples.length - 2]).toBe(total - 1);
		expect(samples[1]).toBe(-startFrame);
	});

	it("gives no reader until the renderer is a second past the start, then follows the growing file", async () => {
		const { cache, producers } = setup();
		const mix = mixOf("a");
		const second = PCM_SAMPLE_RATE;
		cache.prepare(mix);
		const producer = producers[0] as ReturnType<typeof controllableSource>;

		producer.release(second);
		await cache.whenWritten(second);
		expect(cache.open(mix, 0.5)).toBeNull();
		const reader = cache.open(mix, 0) as PcmSource;
		expect(reader).not.toBeNull();
		await reader.ready(second);
		expect(reader.pull(second / 2)?.[0]).toBe(0);
		expect(reader.pull(second / 2)?.[0]).toBe(second / 2);

		// The reader caught up with the file; more frames arrive afterwards.
		producer.release(second);
		await cache.whenWritten(2 * second);
		await reader.ready(second);
		const next = reader.pull(second) as Float32Array;
		expect(next[0]).toBe(second);
		expect(next[2 * (second - 1)]).toBe(2 * second - 1);

		producer.finish();
		await cache.idle();
		await reader.cancel();
	});

	it("is idempotent for an equal mix and replaces the render for another", async () => {
		const { cache, producers, requests } = setup();
		cache.prepare(mixOf("a"));
		cache.prepare(mixOf("a"));
		expect(requests).toHaveLength(1);

		cache.prepare(mixOf("b"));
		expect(requests).toHaveLength(2);
		expect(producers[0]?.cancelled()).toBe(true);
		expect(cache.open(mixOf("a"), 0)).toBeNull();
		producers[1]?.release(PCM_SAMPLE_RATE);
		producers[1]?.finish();
		await cache.idle();
		expect(await readdir(dir)).toEqual(["mix-2.f32"]);
	});

	it("marks a failed render, serves nothing and removes its file", async () => {
		const { cache, producers } = setup();
		const mix = mixOf("a");
		cache.prepare(mix);
		producers[0]?.release(PCM_SAMPLE_RATE);
		producers[0]?.fail(new MediaError("process-failed", "ffmpeg died"));
		await cache.idle();

		expect(cache.status()?.failed).toBe(true);
		expect(cache.open(mix, 0)).toBeNull();
		expect(await readdir(dir)).toEqual([]);
		// The same mix is rendered again when it is prepared again.
		cache.prepare(mix);
		expect(producers).toHaveLength(2);
		producers[1]?.finish();
		await cache.idle();
	});

	it("an empty render is a complete cache whose readers are ended", async () => {
		const { cache, producers } = setup();
		const mix = mixOf("a");
		cache.prepare(mix);
		producers[0]?.finish();
		await cache.idle();

		const reader = cache.open(mix, 0) as PcmSource;
		expect(reader.ended).toBe(true);
	});

	it("wipes leftovers of a previous run on creation and removes everything on dispose", async () => {
		const first = setup();
		first.cache.prepare(mixOf("a"));
		first.producers[0]?.release(4800);
		first.producers[0]?.finish();
		await first.cache.idle();
		expect(existsSync(dir)).toBe(true);

		const second = setup();
		second.cache.prepare(mixOf("z"));
		second.producers[0]?.finish();
		await second.cache.idle();
		expect(await readdir(dir)).toEqual(["mix-1.f32"]);
		await second.cache.dispose();

		expect(existsSync(dir)).toBe(false);
		await first.cache.dispose();
	});
});
