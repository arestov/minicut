import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AudioMixDescriptor } from "../../contracts/audioStream";
import type { PreviewClipSource } from "../../../read-model/previewComps";
import { resolveMediaBinaries } from "../binaries";
import { createMediaService } from "../mediaService";
import { ensureFixtures, type FixtureName } from "../testing/mediaFixtures";
import { PCM_SAMPLE_RATE, type PcmSource } from "./pcmSource";

/**
 * The realtime stream and the export must hear the same mix. Export encodes
 * (Opus), so the comparison decodes the exported file and compares windowed
 * RMS per channel; the stream is checked from the start and from a seek
 * position against the matching window of the same export.
 */

const WINDOW_FRAMES = PCM_SAMPLE_RATE / 10;

const clip = (partial: Record<string, unknown>): PreviewClipSource =>
	({ name: "Clip", inPoint: 0, audio: { gain: 1, pan: 0 }, ...partial }) as unknown as PreviewClipSource;

const drain = async (source: PcmSource): Promise<Float32Array> => {
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

/** RMS per window and channel: result[window] = [left, right]. */
const windowedRms = (samples: Float32Array): Array<[number, number]> => {
	const windows = Math.floor(samples.length / 2 / WINDOW_FRAMES);
	const rows: Array<[number, number]> = [];
	for (let w = 0; w < windows; w += 1) {
		let left = 0;
		let right = 0;
		for (let i = 0; i < WINDOW_FRAMES; i += 1) {
			const frame = w * WINDOW_FRAMES + i;
			left += (samples[2 * frame] as number) ** 2;
			right += (samples[2 * frame + 1] as number) ** 2;
		}
		rows.push([Math.sqrt(left / WINDOW_FRAMES), Math.sqrt(right / WINDOW_FRAMES)]);
	}
	return rows;
};

const expectClose = (
	actual: Array<[number, number]>,
	expected: Array<[number, number]>,
	skipEdges = 1,
) => {
	expect(actual.length).toBeGreaterThan(2 * skipEdges);
	for (let w = skipEdges; w < actual.length - skipEdges; w += 1) {
		for (const channel of [0, 1] as const) {
			const a = (actual[w] as [number, number])[channel];
			const e = (expected[w] as [number, number])[channel];
			const tolerance = 0.06 * Math.max(a, e) + 0.003;
			expect(Math.abs(a - e), `window ${w} channel ${channel}: ${a} vs ${e}`).toBeLessThanOrEqual(tolerance);
		}
	}
};

describe("audio stream and export parity", () => {
	let fixtures: Record<FixtureName, string>;
	let outDir: string;

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-audio", "audio-tone"]);
		outDir = await mkdtemp(path.join(os.tmpdir(), "minicut-audio-parity-"));
	});
	afterAll(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	it("streams the mix an export of the same range contains (gain, pan, delay, trim, overlap)", async () => {
		const media = createMediaService();
		const plan = {
			projectId: "parity",
			fps: 25,
			width: 320,
			height: 240,
			duration: 3,
			clipSources: [
				clip({
					id: "tone",
					resourceId: "res-tone",
					resourceKind: "audio",
					start: 0,
					duration: 2,
					audio: { gain: 0.5, pan: 0 },
				}),
				clip({
					id: "sine",
					resourceId: "res-sine",
					resourceKind: "audio",
					start: 1.3,
					duration: 1.4,
					inPoint: 0.4,
					audio: { gain: 1.2, pan: -0.6 },
				}),
			],
		};
		const assets = {
			"res-tone": { path: fixtures["audio-tone"] },
			"res-sine": { path: fixtures["video-audio"] },
		};
		const audioChannels: Record<string, number> = {};
		for (const [resourceId, location] of Object.entries(assets)) {
			const info = await media.probe({ requestId: `probe-${resourceId}`, source: { path: location.path } });
			audioChannels[resourceId] = info.audio?.channels ?? 2;
		}
		const mix: AudioMixDescriptor = {
			plan: plan as unknown as AudioMixDescriptor["plan"],
			assets,
			audioChannels,
			silentAudioResources: [],
		};

		const outputPath = path.join(outDir, "export.webm");
		const outcome = await media
			.exportPlan({
				requestId: "parity-export",
				plan: plan as never,
				range: { type: "project" },
				outputPath,
				assets,
			})
			.outcome;
		expect(outcome.status).toBe("done");
		const decoded = spawnSync(
			resolveMediaBinaries().ffmpegPath,
			["-v", "error", "-i", outputPath, "-vn", "-f", "f32le", "-ar", "48000", "-ac", "2", "pipe:1"],
			{ maxBuffer: 256 * 1024 * 1024 },
		);
		expect(decoded.status).toBe(0);
		const exported = new Float32Array(
			decoded.stdout.buffer.slice(
				decoded.stdout.byteOffset,
				decoded.stdout.byteOffset + decoded.stdout.byteLength - (decoded.stdout.byteLength % 4),
			),
		);
		const exportedRms = windowedRms(exported);

		const full = await drain(media.streamAudioMix({ ...mix, startSeconds: 0 }));
		expect(full.length / 2).toBe(PCM_SAMPLE_RATE * 3);
		expectClose(windowedRms(full), exportedRms);

		// A seek: the stream from 0.8 s is the export shifted by 8 windows.
		const seeked = await drain(media.streamAudioMix({ ...mix, startSeconds: 0.8 }));
		expect(seeked.length / 2).toBe(Math.round(PCM_SAMPLE_RATE * 2.2));
		expectClose(windowedRms(seeked), exportedRms.slice(8));

		// The mix is not silent in any channel (guards against comparing zeros).
		const loud = windowedRms(full).filter(([l, r]) => l > 0.01 && r > 0.01);
		expect(loud.length).toBeGreaterThan(10);
	});
});
