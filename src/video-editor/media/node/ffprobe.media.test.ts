import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeFile } from "./ffprobe";
import { MediaError } from "./mediaError";
import { ensureFixtures, type FixtureName } from "./testing/mediaFixtures";

const ffprobePath = process.env.MINICUT_FFPROBE_PATH ?? "ffprobe";

describe("probeFile", () => {
	let fixtures: Record<FixtureName, string>;

	const probe = (name: FixtureName) =>
		probeFile(`probe-${name}`, fixtures[name], { ffprobePath });

	it("reports size, fps and duration for a constant-rate clip", async () => {
		fixtures = await ensureFixtures([
			"video-cfr",
			"video-audio",
			"video-vfr",
			"video-offset",
			"audio-tone",
		]);
		const result = await probe("video-cfr");
		expect(result.video).toMatchObject({
			codec: "h264",
			width: 320,
			height: 240,
			variableFrameRate: false,
		});
		expect(result.video?.fps).toBeCloseTo(25, 2);
		expect(result.durationSeconds).toBeCloseTo(2, 1);
		expect(result.audio).toBeNull();
		expect(result.startTimeSeconds).toBeCloseTo(0, 2);
	});

	it("reports audio sample rate and channels", async () => {
		const av = await probe("video-audio");
		expect(av.audio).toMatchObject({ sampleRate: 48000, channels: 2 });
		const tone = await probe("audio-tone");
		expect(tone.video).toBeNull();
		expect(tone.audio).toMatchObject({ sampleRate: 44100, channels: 1 });
		expect(tone.durationSeconds).toBeCloseTo(3, 1);
	});

	it("detects variable frame rate", async () => {
		const vfr = await probe("video-vfr");
		expect(vfr.video?.variableFrameRate).toBe(true);
	});

	it("reports a non-zero start time offset", async () => {
		const offset = await probe("video-offset");
		expect(offset.startTimeSeconds).toBeCloseTo(1.5, 1);
		expect(offset.video?.startTimeSeconds).toBeCloseTo(1.5, 1);
	});

	it("counts frames exactly when requested", async () => {
		const result = await probeFile("count", fixtures["video-cfr"], {
			ffprobePath,
			countFrames: true,
		});
		expect(result.video?.frameCount).toBe(50);
	});

	it("rejects missing files with a typed error", async () => {
		await expect(
			probeFile("missing", "Z:/definitely/not/here.mp4", { ffprobePath }),
		).rejects.toMatchObject({ code: "asset-not-found" });
	});

	it("rejects non-media files with probe-failed", async () => {
		await expect(
			probeFile("bad", fileURLToPath(import.meta.url), {
				ffprobePath,
			}),
		).rejects.toMatchObject({ code: "probe-failed" });
	});

	it("reports a missing ffprobe binary as binary-not-found", async () => {
		const error = await probeFile("nobin", fixtures["video-cfr"], {
			ffprobePath: "ffprobe-does-not-exist",
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(MediaError);
		expect((error as MediaError).code).toBe("binary-not-found");
	});
});
