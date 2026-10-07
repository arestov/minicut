import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PreviewClipSource } from "../../read-model/previewComps";
import type { ExportPlan } from "../../render/renderPlan";
import type { MediaExportFormat } from "../contracts/export";
import type { ProbeResult } from "../contracts/probe";
import { createMediaService } from "./mediaService";
import { ensureFixtures, type FixtureName } from "./testing/mediaFixtures";
import { audioStats, meanLumaAt } from "./testing/mediaMetrics";
import { scenarioAssets, videoAudioScenario } from "./testing/exportScenarios";

const clip = (partial: Record<string, unknown>): PreviewClipSource =>
	({ name: "Clip", inPoint: 0, ...partial }) as unknown as PreviewClipSource;

const planOf = (
	clipSources: PreviewClipSource[],
	duration: number,
): ExportPlan => ({
	projectId: "fx",
	fps: 25,
	width: 320,
	height: 240,
	duration,
	clipSources,
});

describe("FFmpeg export against fixtures", () => {
	let fixtures: Record<FixtureName, string>;
	let outDir: string;
	const service = createMediaService();

	beforeAll(async () => {
		fixtures = await ensureFixtures([
			"video-cfr",
			"video-audio",
			"video-vfr",
			"video-offset",
			"audio-tone",
			"image-card",
		]);
		outDir = await mkdtemp(path.join(os.tmpdir(), "minicut-fixtures-"));
	});
	afterAll(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	const exportPlan = async (
		id: string,
		plan: ExportPlan,
		resources: Record<string, FixtureName>,
		extra: { format?: MediaExportFormat; range?: { type: "clip"; clipId: string } } = {},
	): Promise<{ file: string; info: ProbeResult; frames: number }> => {
		const format = extra.format ?? "webm";
		const file = path.join(outDir, `${id}.${format}`);
		const outcome = await service.exportPlan({
			requestId: id,
			plan,
			range: extra.range ?? { type: "project" },
			format,
			outputPath: file,
			assets: Object.fromEntries(
				Object.entries(resources).map(([rid, fx]) => [rid, { path: fixtures[fx] }]),
			),
		}).outcome;
		if (outcome.status !== "done") {
			throw new Error(`export ${id} -> ${JSON.stringify(outcome)}`);
		}
		const info = await service.probe({ requestId: id, source: { path: file } });
		return { file, info, frames: outcome.artifact.frameCount };
	};

	it("meets duration, frame count, fps, size and audio tolerances", async () => {
		const { info, frames } = await exportPlan(
			"scenario",
			videoAudioScenario.plan,
			videoAudioScenario.resources,
		);
		expect(info.video).toMatchObject({ width: 320, height: 240 });
		expect(info.video?.fps).toBeCloseTo(25, 1);
		expect(info.video?.variableFrameRate).toBe(false);
		expect(frames).toBe(50);
		expect(Math.abs(info.durationSeconds - 2)).toBeLessThan(0.1);
		expect(info.audio).toMatchObject({ codec: "opus", sampleRate: 48000, channels: 2 });
		expect(Math.abs((info.audio?.durationSeconds ?? 0) - 2)).toBeLessThan(0.1);
	});

	it("applies audio gain: 0.5 on a 0.125-amplitude sine is about -27 dBFS RMS", async () => {
		const { file } = await exportPlan(
			"gain",
			videoAudioScenario.plan,
			videoAudioScenario.resources,
		);
		const stats = await audioStats(file);
		// sine amplitude 0.125 * gain 0.5 -> RMS 0.0442 = -27.1 dBFS
		expect(stats.rmsDb).toBeGreaterThan(-28.6);
		expect(stats.rmsDb).toBeLessThan(-25.6);
	});

	it("exports a clip range to exactly the clip duration with its own trim", async () => {
		const { info, frames } = await exportPlan(
			"range",
			videoAudioScenario.plan,
			videoAudioScenario.resources,
			{ range: { type: "clip", clipId: "clip-b" } },
		);
		expect(frames).toBe(25);
		expect(Math.abs(info.durationSeconds - 1)).toBeLessThan(0.1);
		expect(info.audio).toBeNull(); // tone clip is not linked to clip-b
	});

	it("normalises variable-frame-rate sources to constant output fps", async () => {
		const plan = planOf(
			[clip({ id: "v", resourceId: "r", resourceKind: "video", start: 0, duration: 2 })],
			2,
		);
		const { info, frames } = await exportPlan("vfr", plan, { r: "video-vfr" });
		expect(frames).toBe(50);
		expect(info.video?.variableFrameRate).toBe(false);
		expect(info.video?.fps).toBeCloseTo(25, 1);
	});

	it("exports a silent video with its embedded audio clip as silence", async () => {
		const plan = planOf(
			[
				clip({ id: "v", resourceId: "r", resourceKind: "video", start: 0, duration: 1 }),
				clip({ id: "a", resourceId: "r", resourceKind: "audio", start: 0, duration: 1 }),
			],
			1,
		);
		const { info, frames } = await exportPlan("silent-embedded", plan, { r: "video-cfr" });
		expect(frames).toBe(25);
		expect(info.audio).toBeNull();
	});

	it("honours a non-zero source start offset (inPoint is media-relative)", async () => {
		const plan = planOf(
			[
				clip({ id: "v", resourceId: "r", resourceKind: "video", start: 0, duration: 1 }),
				clip({ id: "a", resourceId: "r", resourceKind: "audio", start: 0, duration: 1 }),
			],
			1,
		);
		const { file, info, frames } = await exportPlan("offset", plan, { r: "video-offset" });
		expect(frames).toBe(25);
		expect(Math.abs(info.durationSeconds - 1)).toBeLessThan(0.1);
		// First frame must carry picture content, not the black base, and audio must not be silent.
		expect(await meanLumaAt(file, 0.1)).toBeGreaterThan(40);
		expect((await audioStats(file)).rmsDb).toBeGreaterThan(-40);
	});

	it("leaves gaps black and layers an image clip in plan order", async () => {
		const plan = planOf(
			[
				clip({ id: "img", resourceId: "i", resourceKind: "image", start: 1, duration: 1 }),
			],
			2,
		);
		const { file } = await exportPlan("image", plan, { i: "image-card" });
		expect(await meanLumaAt(file, 0.3)).toBeLessThan(25);
		expect(await meanLumaAt(file, 1.5)).toBeGreaterThan(40);
	});

	it("writes H.264/AAC MP4 when requested", async () => {
		const { info, frames } = await exportPlan(
			"mp4",
			videoAudioScenario.plan,
			videoAudioScenario.resources,
			{ format: "mp4" },
		);
		expect(info.video?.codec).toBe("h264");
		expect(info.audio?.codec).toBe("aac");
		expect(frames).toBe(50);
	});

	it("process-timeout is typed, kills ffmpeg and leaves nothing behind", async () => {
		const pids: number[] = [];
		const slow = createMediaService({
			jobTimeoutMs: 300,
			onProcessStart: (pid) => pids.push(pid),
		});
		const plan = planOf(
			[clip({ id: "v", resourceId: "r", resourceKind: "video", start: 0, duration: 2 })],
			600,
		);
		const outcome = await slow.exportPlan({
			requestId: "timeout",
			plan,
			range: { type: "project" },
			outputPath: path.join(outDir, "timeout.webm"),
			width: 1280,
			height: 720,
			assets: { r: { path: fixtures["video-cfr"] } },
		}).outcome;
		expect(outcome).toMatchObject({ status: "error", error: { code: "process-timeout" } });
		expect(() => process.kill(pids[0], 0)).toThrow();
		const leftovers = (await readdir(outDir)).filter((n) => n.includes("timeout"));
		expect(leftovers).toEqual([]);
	});
});
