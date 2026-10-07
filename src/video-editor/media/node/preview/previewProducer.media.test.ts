import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PreviewClipSource } from "../../../read-model/previewComps";
import type { ExportPlan } from "../../../render/renderPlan";
import { ensureFixtures, type FixtureName } from "../testing/mediaFixtures";
import {
	createPreviewProducer,
	type PreviewProducer,
	type PreviewProducerOptions,
} from "./previewProducer";
import type { ProducedPreviewFrame } from "./previewTypes";

const W = 160;
const H = 120;

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const clip = (partial: Record<string, unknown>): PreviewClipSource =>
	({ name: "Clip", inPoint: 0, ...partial }) as unknown as PreviewClipSource;

const plan: ExportPlan = {
	projectId: "producer",
	fps: 25,
	width: 320,
	height: 240,
	duration: 2,
	clipSources: [
		clip({
			id: "blue",
			resourceId: "res-blue",
			resourceKind: "video",
			start: 0.5,
			duration: 1,
		}),
	],
};

describe("preview producer", () => {
	let fixtures: Record<FixtureName, string>;
	let producer: PreviewProducer | null = null;

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-blue-webm"]);
	});
	afterEach(async () => {
		await producer?.dispose();
		producer = null;
	});

	const create = (extra: Partial<PreviewProducerOptions> = {}) => {
		const created = createPreviewProducer({
			ffmpegPath: process.env.MINICUT_FFMPEG_PATH ?? "ffmpeg",
			width: W,
			height: H,
			...extra,
		});
		created.setSource({
			revision: "r1",
			plan,
			assetPaths: { "res-blue": fixtures["video-blue-webm"] },
		});
		producer = created;
		return created;
	};

	/** Resolves with the next frame the producer delivers. */
	const nextFrame = (target: PreviewProducer): Promise<ProducedPreviewFrame> =>
		new Promise((resolve) => {
			const stop = target.onFrame((frame) => {
				stop();
				resolve(frame);
			});
		});

	it("a burst delivers the in-flight frame and the newest one, with at most two decodes", async () => {
		const pids: number[] = [];
		const target = create({ onProcessStart: (pid) => pids.push(pid) });
		const delivered: number[] = [];
		target.onFrame((frame) => {
			delivered.push(frame.generation);
			frame.release();
		});
		for (let generation = 1; generation <= 6; generation += 1) {
			target.request(generation * 0.27, generation);
		}
		await target.idle();
		expect(delivered).toEqual([1, 6]);
		expect(pids).toHaveLength(2);
		expect(target.stats()).toMatchObject({
			decodes: 2,
			coalesced: 4,
			cancelled: 0,
			poolOutstanding: 0,
		});
		for (const pid of pids) expect(isAlive(pid)).toBe(false);
	});

	it("a scrub keeps producing frames while requests keep arriving", async () => {
		const target = create();
		const delivered: number[] = [];
		let generation = 0;
		let settle: () => void = () => undefined;
		const enough = new Promise<void>((resolve) => {
			settle = resolve;
		});
		target.onFrame((frame) => {
			delivered.push(frame.generation);
			frame.release();
			// Keep scrubbing from inside the delivery: each frame is answered by a
			// fresh request, the way a drag keeps asking for new times.
			if (delivered.length >= 3) settle();
			else {
				generation += 1;
				target.request(0.1 + generation * 0.31, generation);
			}
		});
		generation += 1;
		target.request(0.1, generation);
		generation += 1;
		target.request(0.4, generation); // overtakes the first while it decodes
		await enough;
		await target.idle();
		expect(delivered.length).toBeGreaterThan(1);
		expect(delivered).toEqual([...delivered].sort((a, b) => a - b));
		expect(target.stats().cancelled).toBe(0);
	});

	it("cancels the running decode when the source revision changes", async () => {
		const pids: number[] = [];
		const target = create({ onProcessStart: (pid) => pids.push(pid) });
		const delivered: number[] = [];
		target.onFrame((frame) => {
			delivered.push(frame.generation);
			frame.release();
		});
		target.request(1, 1);
		target.request(1.5, 2); // pending behind the first
		target.setSource({
			revision: "r2",
			plan,
			assetPaths: { "res-blue": fixtures["video-blue-webm"] },
		});
		await target.idle();
		expect(delivered).toEqual([]);
		expect(target.stats()).toMatchObject({ cancelled: 1, poolOutstanding: 0 });
		expect(isAlive(pids[0])).toBe(false);
	});

	it("counts frames dropped because the consumer holds every buffer", async () => {
		const target = create({ poolCapacity: 1 });
		const held: ProducedPreviewFrame[] = [];
		target.onFrame((frame) => held.push(frame));
		target.request(0.2, 1);
		await target.idle();
		target.request(0.6, 2); // decode path: pool exhausted
		await target.idle();
		target.request(0.2, 3); // cache hit: pool exhausted
		expect(held).toHaveLength(1);
		expect(target.stats().droppedExhausted).toBe(2);
		held[0].release();
		expect(target.stats().poolOutstanding).toBe(0);
	});

	it("ignores a request that is not newer than the latest generation", async () => {
		const target = create();
		const delivered: number[] = [];
		target.onFrame((frame) => {
			delivered.push(frame.generation);
			frame.release();
		});
		target.request(1, 5);
		target.request(0.2, 4);
		target.request(0.2, 5);
		await target.idle();
		expect(delivered).toEqual([5]);
		expect(target.stats().staleRequests).toBe(2);
	});

	it("serves a repeated time from the cache without a new decode", async () => {
		const target = create();
		const first = nextFrame(target);
		target.request(1, 1);
		const decoded = await first;
		const pixels = decoded.pixels.slice();
		decoded.release();
		await target.idle();

		const second = nextFrame(target);
		target.request(1.01, 2); // same 25fps slot as 1.0
		const cached = await second;
		expect(cached.generation).toBe(2);
		expect(cached.pixels).toEqual(pixels);
		cached.release();
		expect(target.stats()).toMatchObject({ decodes: 1, cacheHits: 1, poolOutstanding: 0 });
	});

	it("drops the cache when the source revision changes", async () => {
		const target = create();
		const first = nextFrame(target);
		target.request(1, 1);
		(await first).release();
		await target.idle();
		expect(target.stats().cacheSize).toBe(1);
		target.setSource({
			revision: "r2",
			plan,
			assetPaths: { "res-blue": fixtures["video-blue-webm"] },
		});
		expect(target.stats().cacheSize).toBe(0);
	});

	it("reports a decode failure for the requested generation", async () => {
		const target = create();
		target.setSource({
			revision: "bad",
			plan: {
				...plan,
				clipSources: [clip({ ...plan.clipSources[0], opacity: { value: 0.5 } })],
			},
			assetPaths: { "res-blue": fixtures["video-blue-webm"] },
		});
		const failure = new Promise<{ code: string; generation: number }>((resolve) => {
			target.onError((error, generation) => resolve({ code: error.code, generation }));
		});
		target.request(1, 9);
		expect(await failure).toEqual({ code: "unsupported-operation", generation: 9 });
	});
});
