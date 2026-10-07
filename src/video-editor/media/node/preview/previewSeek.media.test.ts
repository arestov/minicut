import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaService } from "../mediaService";
import { runCaptured } from "../processRunner";
import { scenarioAssets, videoAudioScenario } from "../testing/exportScenarios";
import type { PreviewClipSource } from "../../../read-model/previewComps";
import type { ExportPlan } from "../../../render/renderPlan";
import { ensureFixtures, type FixtureName } from "../testing/mediaFixtures";
import { createPreviewProducer } from "./previewProducer";
import type { ProducedPreviewFrame } from "./previewTypes";

const FFMPEG = process.env.MINICUT_FFMPEG_PATH ?? "ffmpeg";
const W = 320;
const H = 240;
const FPS = 25;

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("preview producer against fixtures", () => {
	let fixtures: Record<FixtureName, string>;
	let dir: string;
	let assetPaths: Record<string, string>;

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr", "audio-tone", "image-card"]);
		dir = await mkdtemp(path.join(os.tmpdir(), "minicut-preview-"));
		assetPaths = Object.fromEntries(
			Object.entries(scenarioAssets(videoAudioScenario, fixtures)).map(
				([id, location]) => [id, (location as { path: string }).path],
			),
		);
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const createProducer = (extra: { poolCapacity?: number } = {}) => {
		const pids: number[] = [];
		const producer = createPreviewProducer({
			ffmpegPath: FFMPEG,
			width: W,
			height: H,
			onProcessStart: (pid) => pids.push(pid),
			...extra,
		});
		producer.setSource({
			revision: "scenario",
			plan: videoAudioScenario.plan,
			assetPaths,
		});
		return { producer, pids };
	};

	it("a fast seek sequence never presents an older generation", async () => {
		const { producer, pids } = createProducer();
		const delivered: number[] = [];
		producer.onFrame((frame) => {
			delivered.push(frame.generation);
			frame.release();
		});
		const times = [0.1, 1.7, 0.4, 1.2, 0.9, 1.9, 0.0, 1.5, 0.6];
		// Bursts of three requests without waiting, then let the burst settle:
		// the first one is in flight, the newest one waits behind it.
		let generation = 0;
		for (let burst = 0; burst < 3; burst += 1) {
			for (const time of times.slice(burst * 3, burst * 3 + 3)) {
				generation += 1;
				producer.request(time, generation);
			}
			await producer.idle();
		}
		await producer.dispose();

		expect(delivered).toEqual([...delivered].sort((a, b) => a - b));
		expect(delivered.at(-1)).toBe(generation);
		// Per burst: the in-flight frame and the newest request; the middle one
		// is coalesced away.
		expect(delivered).toEqual([1, 3, 4, 6, 7, 9]);
		expect(producer.stats().coalesced).toBe(3);
		expect(pids.length).toBeGreaterThan(0);
		for (const pid of pids) expect(isAlive(pid)).toBe(false);
	});

	it("keeps the pool bounded when the consumer never releases frames", async () => {
		const { producer } = createProducer({ poolCapacity: 2 });
		const held: ProducedPreviewFrame[] = [];
		producer.onFrame((frame) => held.push(frame));
		for (let generation = 1; generation <= 5; generation += 1) {
			producer.request(generation * 0.2, generation);
			await producer.idle();
		}
		expect(held).toHaveLength(2);
		expect(producer.stats()).toMatchObject({ poolAllocated: 2, poolOutstanding: 2 });
		for (const frame of held) frame.release();
		expect(producer.stats().poolOutstanding).toBe(0);
		await producer.dispose();
	});

	it("cancelling by dispose leaves no decoder process behind", async () => {
		const { producer, pids } = createProducer();
		producer.onFrame((frame) => frame.release());
		producer.request(1.5, 1);
		expect(pids).toHaveLength(1);
		await producer.dispose();
		expect(isAlive(pids[0])).toBe(false);
		expect(producer.stats().poolOutstanding).toBe(0);
	});

	/**
	 * Exports `plan`, then checks that the preview frame at each time scores
	 * SSIM > 0.9 against the export frame of the same slot. Times in `moving`
	 * also need a neighbouring export frame to score clearly lower, so the
	 * comparison is sensitive to a one-frame error there.
	 */
	const expectPreviewMatchesExport = async (
		name: string,
		plan: ExportPlan,
		resources: Record<string, FixtureName>,
		times: number[],
		moving: number[],
	): Promise<void> => {
		const scenario = { name, plan, resources };
		const exported = path.join(dir, `${name}.webm`);
		const job = createMediaService().exportPlan({
			requestId: name,
			plan,
			range: { type: "project" },
			outputPath: exported,
			assets: scenarioAssets(scenario, fixtures),
		});
		const outcome = await job.outcome;
		expect(outcome.status, JSON.stringify(outcome)).toBe("done");

		const producer = createPreviewProducer({
			ffmpegPath: FFMPEG,
			width: W,
			height: H,
		});
		producer.setSource({
			revision: name,
			plan,
			assetPaths: Object.fromEntries(
				Object.entries(scenarioAssets(scenario, fixtures)).map(
					([id, location]) => [id, (location as { path: string }).path],
				),
			),
		});
		const ssimAgainst = async (
			rawPath: string,
			exportIndex: number,
		): Promise<number> => {
			const result = await runCaptured(
				FFMPEG,
				[
					"-hide_banner", "-nostdin", "-v", "info",
					"-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-i", rawPath,
					"-i", exported,
					"-filter_complex",
					`[0:v]format=yuv420p[p];[1:v]select='eq(n,${exportIndex})',format=yuv420p[e];[e][p]ssim`,
					"-frames:v", "1", "-f", "null", "-",
				],
				{ timeoutMs: 60_000 },
			);
			expect(result.exitCode).toBe(0);
			const match = /SSIM[^\n]*All:([\d.]+)/.exec(result.stderr);
			expect(match, result.stderr.slice(-400)).not.toBeNull();
			return Number(match?.[1]);
		};
		let generation = 0;
		for (const time of times) {
			generation += 1;
			const frame = await new Promise<ProducedPreviewFrame>((resolve) => {
				producer.onFrame(resolve);
				producer.request(time, generation);
			});
			const rawPath = path.join(dir, `${name}-${generation}.rgba`);
			await writeFile(rawPath, frame.pixels);
			frame.release();
			const index = Math.floor(time * FPS + 1e-6);
			const same = await ssimAgainst(rawPath, index);
			expect(same, `${name} t=${time}`).toBeGreaterThan(0.9);
			if (moving.includes(time)) {
				const other = await ssimAgainst(rawPath, index === 49 ? 48 : index + 1);
				expect(other, `${name} control t=${time}`).toBeLessThan(same - 0.04);
			}
		}
		await producer.dispose();
	};

	it("matches the export frame at the same time (SSIM)", async () => {
		// 0.3 and 1.2 sit in different clips (clip-a trimmed by 0.5s, clip-b).
		await expectPreviewMatchesExport(
			"video-audio-sequence",
			videoAudioScenario.plan,
			videoAudioScenario.resources,
			[0.3, 1.2, 1.96],
			[0.3, 1.2, 1.96],
		);
	});

	it("matches the export for a trimmed clip at t>0 and an image layered on top", async () => {
		const clip = (partial: Record<string, unknown>): PreviewClipSource =>
			({ name: "Clip", ...partial }) as unknown as PreviewClipSource;
		const plan: ExportPlan = {
			projectId: "trim-image",
			fps: FPS,
			width: W,
			height: H,
			duration: 2,
			clipSources: [
				clip({
					id: "trimmed",
					resourceId: "res-video",
					resourceKind: "video",
					start: 0.5,
					duration: 1.2,
					inPoint: 0.72, // frame-aligned: a sub-frame in-point can shift preview vs export by one frame
				}),
				clip({
					id: "card",
					resourceId: "res-image",
					resourceKind: "image",
					start: 1.4,
					duration: 0.6,
					inPoint: 0,
				}),
			],
		};
		await expectPreviewMatchesExport(
			"trim-image",
			plan,
			{ "res-video": "video-cfr", "res-image": "image-card" },
			// black, trimmed (source 1.1s, 1.5s... in), trimmed+image, image only
			[0.2, 0.8, 1.2, 1.5, 1.8],
			[0.8, 1.2], // at 1.5 the image hides most of the moving video
		);
	});
});
