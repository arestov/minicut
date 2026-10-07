import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCaptured } from "./processRunner";
import { createMediaService } from "./mediaService";
import { ensureFixtures, type FixtureName } from "./testing/mediaFixtures";

describe("media service proxy", () => {
	let fixtures: Record<FixtureName, string>;
	let outDir: string;
	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-audio"]);
		outDir = await mkdtemp(path.join(os.tmpdir(), "minicut-proxy-"));
	});
	afterAll(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	const keyframeCount = async (file: string): Promise<number> => {
		const result = await runCaptured("ffprobe", [
			"-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
			"-show_entries", "frame=pts_time", "-of", "csv=p=0", file,
		], { timeoutMs: 30_000 });
		return result.stdout.split("\n").filter((l) => l.trim()).length;
	};

	it("generates a downscaled H.264 proxy with a short GOP", async () => {
		const service = createMediaService();
		const outputPath = path.join(outDir, "proxy.mp4");
		const outcome = await service.generateProxy({
			requestId: "proxy",
			source: { path: fixtures["video-audio"] },
			outputPath,
			height: 120,
		}).outcome;
		expect(outcome.status).toBe("done");
		if (outcome.status !== "done") return;
		expect(outcome.artifact.frameCount).toBe(50);
		const info = await service.probe({ requestId: "p", source: { path: outputPath } });
		expect(info.video).toMatchObject({ codec: "h264", height: 120, width: 160 });
		expect(info.audio).not.toBeNull();
		expect(await keyframeCount(outputPath)).toBeGreaterThanOrEqual(4);
	});

	it("makes every frame a keyframe in all-intra mode", async () => {
		const service = createMediaService();
		const outputPath = path.join(outDir, "intra.mp4");
		const outcome = await service.generateProxy({
			requestId: "intra",
			source: { path: fixtures["video-audio"] },
			outputPath,
			height: 120,
			allIntra: true,
		}).outcome;
		expect(outcome.status).toBe("done");
		expect(await keyframeCount(outputPath)).toBe(50);
	});

	it("fails typed for sources without video", async () => {
		const audioOnly = (await ensureFixtures(["audio-tone"]))["audio-tone"];
		const outcome = await createMediaService().generateProxy({
			requestId: "novideo",
			source: { path: audioOnly },
			outputPath: path.join(outDir, "x.mp4"),
		}).outcome;
		expect(outcome).toMatchObject({ status: "error", error: { code: "invalid-request" } });
	});
});
