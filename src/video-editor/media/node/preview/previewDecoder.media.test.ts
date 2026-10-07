import { beforeAll, describe, expect, it } from "vitest";
import type { PreviewClipSource } from "../../../read-model/previewComps";
import type { ExportPlan } from "../../../render/renderPlan";
import { ensureFixtures, type FixtureName } from "../testing/mediaFixtures";
import { createFramePool } from "./framePool";
import { decodePreviewFrame, startPreviewDecode } from "./previewDecoder";
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

/** Black until 0.5s, then solid blue for one second, black again. */
const plan: ExportPlan = {
	projectId: "decode",
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
		clip({
			id: "tone",
			resourceId: "res-tone",
			resourceKind: "audio",
			start: 0,
			duration: 2,
		}),
	],
};

const centre = (frame: ProducedPreviewFrame): [number, number, number, number] => {
	const i = ((H >> 1) * W + (W >> 1)) * 4;
	return [frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2], frame.pixels[i + 3]];
};

describe("preview decoder", () => {
	let fixtures: Record<FixtureName, string>;
	const base = () => ({
		ffmpegPath: process.env.MINICUT_FFMPEG_PATH ?? "ffmpeg",
		plan,
		assetPaths: {
			"res-blue": fixtures["video-blue-webm"],
			"res-tone": fixtures["audio-tone"],
		},
		width: W,
		height: H,
		generation: 7,
		streamId: "test",
		pool: createFramePool({ byteLength: W * H * 4, capacity: 4 }),
	});

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-blue-webm", "audio-tone"]);
	});

	it("decodes the frame at a time: black outside the clip, blue inside", async () => {
		const options = base();
		const black = await decodePreviewFrame({ ...options, timeSeconds: 0.2 }).result;
		const blue = await decodePreviewFrame({ ...options, timeSeconds: 1 }).result;
		expect(black).not.toBeNull();
		expect(blue).not.toBeNull();
		if (!black || !blue) return;
		expect(black.width).toBe(W);
		expect(black.stride).toBe(W * 4);
		expect(black.generation).toBe(7);
		expect(black.ptsSeconds).toBeCloseTo(0.2, 5);
		expect(centre(black)).toEqual([0, 0, 0, 255]);
		const [r, g, b, a] = centre(blue);
		expect(b).toBeGreaterThan(200);
		expect(r).toBeLessThan(40);
		expect(g).toBeLessThan(40);
		expect(a).toBe(255);
		expect(options.pool.outstanding).toBe(2);
		black.release();
		blue.release();
		expect(options.pool.outstanding).toBe(0);
	});

	it("streams a range from a time to the end of the plan with increasing pts", async () => {
		const options = base();
		const frames: Array<{ sequence: number; ptsSeconds: number }> = [];
		const handle = startPreviewDecode({
			...options,
			timeSeconds: 1.2,
			onFrame: (frame) => {
				frames.push({ sequence: frame.sequence, ptsSeconds: frame.ptsSeconds });
				frame.release();
			},
		});
		const outcome = await handle.outcome;
		expect(outcome).toMatchObject({ status: "done", frames: 20, dropped: 0 });
		expect(frames.map((f) => f.sequence)).toEqual([...Array(20).keys()]);
		expect(frames[0].ptsSeconds).toBeCloseTo(1.2, 5);
		expect(frames[19].ptsSeconds).toBeCloseTo(1.96, 5);
		expect(options.pool.outstanding).toBe(0);
	});

	it("drops frames instead of growing when the consumer holds every buffer", async () => {
		const options = {
			...base(),
			pool: createFramePool({ byteLength: W * H * 4, capacity: 2 }),
		};
		const held: ProducedPreviewFrame[] = [];
		const outcome = await startPreviewDecode({
			...options,
			timeSeconds: 0,
			frameCount: 10,
			onFrame: (frame) => held.push(frame),
		}).outcome;
		expect(outcome).toMatchObject({ status: "done", frames: 10, dropped: 8 });
		expect(options.pool.allocated).toBe(2);
		for (const frame of held) frame.release();
		expect(options.pool.outstanding).toBe(0);
	});

	it("cancel kills the process and delivers nothing afterwards", async () => {
		const options = base();
		const longPlan = { ...plan, duration: 600 };
		const got: ProducedPreviewFrame[] = [];
		let firstFrame: () => void = () => undefined;
		const first = new Promise<void>((resolve) => {
			firstFrame = resolve;
		});
		const handle = startPreviewDecode({
			...options,
			plan: longPlan,
			timeSeconds: 0,
			onFrame: (frame) => {
				got.push(frame);
				firstFrame();
			},
		});
		const pid = handle.pid as number;
		await first;
		await handle.cancel();
		const countAtCancel = got.length;
		const outcome = await handle.outcome;
		expect(outcome.status).toBe("cancelled");
		expect(isAlive(pid)).toBe(false);
		expect(got.length).toBe(countAtCancel);
		for (const frame of got) frame.release();
		expect(options.pool.outstanding).toBe(0);
	});

	it("reports the export capability error for unsupported operations", async () => {
		const options = base();
		const bad: ExportPlan = {
			...plan,
			clipSources: [clip({ ...plan.clipSources[0], opacity: { value: 0.5 } })],
		};
		const outcome = await startPreviewDecode({
			...options,
			plan: bad,
			timeSeconds: 1,
			frameCount: 1,
			onFrame: (frame) => frame.release(),
		}).outcome;
		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.error.code).toBe("unsupported-operation");
		}
	});

	it("fails with binary-not-found for a missing ffmpeg", async () => {
		const options = base();
		const outcome = await startPreviewDecode({
			...options,
			ffmpegPath: "ffmpeg-does-not-exist",
			timeSeconds: 0,
			frameCount: 1,
			onFrame: (frame) => frame.release(),
		}).outcome;
		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.error.code).toBe("binary-not-found");
		}
	});
});
