import { beforeAll, describe, expect, it } from "vitest";
import { createMediaService } from "./mediaService";
import { PCM_SAMPLE_RATE, type PcmSource } from "./audio/pcmSource";
import { scenarioAssets, videoAudioScenario } from "./testing/exportScenarios";
import { ensureFixtures, type FixtureName } from "./testing/mediaFixtures";

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Pulls a source to the end; returns the interleaved samples. */
const drain = async (source: PcmSource): Promise<Float32Array> => {
	const parts: Float32Array[] = [];
	const waitable = source as PcmSource & { ready?(frames: number): Promise<void> };
	while (!source.ended) {
		await waitable.ready?.(4800);
		const part = source.pull(4800);
		if (part) parts.push(part);
	}
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const all = new Float32Array(total);
	let offset = 0;
	for (const part of parts) {
		all.set(part, offset);
		offset += part.length;
	}
	return all;
};

describe("media service audio stream", () => {
	let fixtures: Record<FixtureName, string>;

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr", "audio-tone"]);
	});

	const request = (extra: Record<string, unknown> = {}) => ({
		plan: videoAudioScenario.plan,
		assets: scenarioAssets(videoAudioScenario, fixtures),
		audioChannels: {},
		silentAudioResources: [],
		startSeconds: 0,
		...extra,
	});

	it("streams the whole timeline mix as f32 stereo from the start", async () => {
		const samples = await drain(createMediaService().streamAudioMix(request()));
		expect(samples.length / 2).toBe(PCM_SAMPLE_RATE * 2);
		let peak = 0;
		for (const value of samples) peak = Math.max(peak, Math.abs(value));
		// 0.5 gain on a quiet tone fixture: audible, below the gain-limited ceiling.
		expect(peak).toBeGreaterThan(0.01);
		expect(peak).toBeLessThanOrEqual(0.5 + 1e-3);
	});

	it("starts at the requested cursor and ends at the plan end", async () => {
		const samples = await drain(
			createMediaService().streamAudioMix(request({ startSeconds: 0.75 })),
		);
		expect(samples.length / 2).toBe(Math.round(PCM_SAMPLE_RATE * 1.25));
	});

	it("returns an ended empty stream past the last audio clip", async () => {
		const source = createMediaService().streamAudioMix(
			request({ startSeconds: 2 }),
		);
		expect(source.ended).toBe(true);
		expect(source.pull(960)).toBeNull();
	});

	it("cancel stops the ffmpeg process", async () => {
		const pids: number[] = [];
		const service = createMediaService({ onProcessStart: (pid) => pids.push(pid) });
		const source = service.streamAudioMix(request());
		expect(pids).toHaveLength(1);

		await source.cancel();

		expect(isAlive(pids[0] as number)).toBe(false);
	});

	it("reports a missing source file as a stream error", async () => {
		const source = createMediaService().streamAudioMix(
			request({ assets: { "res-tone": { path: "Z:/does/not/exist.wav" } } }),
		);
		await (source as PcmSource & { ready(n: number): Promise<void> }).ready(1);
		expect(source.error).toMatchObject({ code: "process-failed" });
	});
});
