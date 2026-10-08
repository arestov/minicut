import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type ByteRangeSource,
	sniffAudioStreams,
} from "../audioStreamSniffer";
import { resolveMediaBinaries } from "./binaries";
import { runCaptured } from "./processRunner";
import { ensureFixtures, type FixtureName } from "./testing/mediaFixtures";

const { ffmpegPath, ffprobePath } = resolveMediaBinaries();

const fileSource = async (file: string): Promise<ByteRangeSource & { close(): Promise<void>; bytesRead(): number }> => {
	const handle = await open(file, "r");
	const { size } = await handle.stat();
	let total = 0;
	return {
		size,
		async readRange(start, end) {
			const length = Math.max(0, Math.min(end, size) - start);
			const buffer = new Uint8Array(length);
			await handle.read(buffer, 0, length, start);
			total += length;
			return buffer;
		},
		close: () => handle.close(),
		bytesRead: () => total,
	};
};

const ffprobeAudio = async (file: string): Promise<{ count: number; channels: number | null; sampleRate: number | null }> => {
	const result = await runCaptured(ffprobePath, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=channels,sample_rate", "-of", "json", file]);
	const streams = (JSON.parse(result.stdout) as { streams: Array<{ channels?: number; sample_rate?: string }> }).streams;
	return {
		count: streams.length,
		channels: streams[0]?.channels ?? null,
		sampleRate: streams[0] ? Number(streams[0].sample_rate) : null,
	};
};

describe("audio stream sniffer against ffprobe", () => {
	let fixtures: Record<FixtureName, string>;
	let dir: string;
	const generated: Record<string, string> = {};

	beforeAll(async () => {
		fixtures = await ensureFixtures([
			"video-cfr",
			"video-audio",
			"video-av-webm",
			"video-blue-webm",
			"video-red-bt709",
			"video-vfr",
			"video-vfr-webm",
			"video-offset",
		]);
		dir = await mkdtemp(path.join(os.tmpdir(), "minicut-sniff-"));
		const video = ["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=1"];
		const tone = (n: number) => ["-f", "lavfi", "-i", `sine=frequency=${300 + n}:sample_rate=44100:duration=1`];
		const make = async (name: string, args: string[]) => {
			generated[name] = path.join(dir, name);
			await runCaptured(ffmpegPath, ["-y", ...args, generated[name]], { timeoutMs: 60_000 });
		};
		await make("silent.mp4", [...video, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"]);
		await make("silent-faststart.mp4", [...video, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"]);
		await make("silent.mov", [...video, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"]);
		await make("silent.webm", [...video, "-c:v", "libvpx-vp9", "-an"]);
		await make("silent.mkv", [...video, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"]);
		await make("two-audio.mkv", [...video, ...tone(0), ...tone(1), "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
		await make("two-audio.mp4", [...video, ...tone(0), ...tone(1), "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
		await make("fragmented.mp4", [...video, ...tone(0), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "frag_keyframe+empty_moov"]);
		await make("silent-fragmented.mp4", [...video, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-movflags", "frag_keyframe+empty_moov"]);
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const cases = (): Array<[string, string]> => [
		...(Object.entries(fixtures) as Array<[string, string]>),
		...Object.entries(generated),
	];

	it("reports the same audio stream count, channels and sample rate as ffprobe on every file", async () => {
		const checked: string[] = [];
		for (const [name, file] of cases()) {
			const source = await fileSource(file);
			try {
				const expected = await ffprobeAudio(file);
				const sniffed = await sniffAudioStreams(source);
				expect(sniffed, name).not.toBeNull();
				expect(sniffed?.audioStreams, name).toBe(expected.count);
				if (expected.count > 0) {
					expect(sniffed?.audioChannels, name).toBe(expected.channels);
					expect(sniffed?.audioSampleRate, name).toBe(expected.sampleRate);
				}
				checked.push(name);
			} finally {
				await source.close();
			}
		}
		expect(checked.length).toBeGreaterThan(15);
	});

	it("covers silent and audio-bearing files of both container families", async () => {
		const counts = new Map<string, number>();
		for (const [name, file] of cases()) counts.set(name, (await ffprobeAudio(file)).count);
		expect(counts.get("silent.mp4")).toBe(0);
		expect(counts.get("silent.webm")).toBe(0);
		expect(counts.get("two-audio.mkv")).toBe(2);
		expect(counts.get("video-audio")).toBe(1);
	});

	it("reads headers only, not the media payload", async () => {
		const source = await fileSource(fixtures["video-audio"]);
		try {
			await sniffAudioStreams(source);
			expect(source.bytesRead()).toBeLessThan(source.size);
		} finally {
			await source.close();
		}
	});

	it("returns null (unknown) for unsupported or truncated input", async () => {
		const bytes = (data: Uint8Array): ByteRangeSource => ({ size: data.length, readRange: async (s, e) => data.slice(s, e) });
		expect(await sniffAudioStreams(bytes(new TextEncoder().encode("RIFF....WAVEfmt this is not a container")))).toBeNull();
		expect(await sniffAudioStreams(bytes(new Uint8Array(4)))).toBeNull();
		const wav = (await ensureFixtures(["audio-tone"]))["audio-tone"];
		const wavSource = await fileSource(wav);
		try {
			expect(await sniffAudioStreams(wavSource)).toBeNull();
		} finally {
			await wavSource.close();
		}
		const source = await fileSource(fixtures["video-audio"]);
		try {
			const head = await source.readRange(0, 200);
			expect(await sniffAudioStreams(bytes(head))).toBeNull();
		} finally {
			await source.close();
		}
	});
});
