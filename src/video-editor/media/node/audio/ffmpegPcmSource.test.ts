import { describe, expect, it } from "vitest";
import { MediaError } from "../mediaError";
import { createFfmpegPcmSource } from "./ffmpegPcmSource";
import { PCM_SAMPLE_RATE } from "./pcmSource";

/** The test process stands in for ffmpeg: node writes frames whose left sample is the frame index. */
const node = (script: string) => ({
	ffmpegPath: process.execPath,
	args: ["-e", script],
});

const frameWriter = (totalFrames: number) => `
const total = ${totalFrames};
let frame = 0;
const out = process.stdout;
const writeSome = () => {
	while (frame < total) {
		const count = Math.min(4096, total - frame);
		const data = new Float32Array(count * 2);
		for (let i = 0; i < count; i += 1) { data[2 * i] = frame + i; data[2 * i + 1] = -(frame + i); }
		frame += count;
		if (!out.write(Buffer.from(data.buffer))) { out.once('drain', writeSome); return; }
	}
	out.end();
};
writeSome();
`;

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("ffmpeg PCM source", () => {
	it("delivers every frame in order and keeps buffering bounded by the high water mark", async () => {
		const total = PCM_SAMPLE_RATE * 6;
		const high = PCM_SAMPLE_RATE / 2;
		const source = createFfmpegPcmSource({
			...node(frameWriter(total)),
			highWaterFrames: high,
			lowWaterFrames: high / 2,
		});
		let next = 0;
		let maxBuffered = 0;
		const step = 4800;
		while (!source.ended) {
			await source.ready(step);
			maxBuffered = Math.max(maxBuffered, source.bufferedFrames);
			const chunk = source.pull(step);
			if (!chunk) continue;
			const frames = chunk.length / 2;
			expect(chunk[0]).toBe(next);
			expect(chunk[2 * (frames - 1)]).toBe(next + frames - 1);
			expect(chunk[1]).toBe(-next);
			next += frames;
		}
		expect(next).toBe(total);
		expect(source.error).toBeNull();
		// The pipe holds a little more than the mark (OS pipe + one read); never the whole stream.
		expect(maxBuffered).toBeLessThan(high + 32768);
		expect(maxBuffered).toBeLessThan(total / 4);
	});

	it("returns the final remainder once the producer finished", async () => {
		const source = createFfmpegPcmSource(node(frameWriter(1000)));
		await source.closed;
		expect(source.bufferedFrames).toBe(1000);
		expect(source.pull(960)).toHaveLength(1920);
		expect(source.pull(960)).toHaveLength(80);
		expect(source.ended).toBe(true);
		expect(source.pull(960)).toBeNull();
	});

	it("skips buffered frames and continues from there", async () => {
		const source = createFfmpegPcmSource(node(frameWriter(5000)));
		await source.closed;
		expect(source.skip(1200)).toBe(1200);
		expect(source.pull(10)?.[0]).toBe(1200);
		expect(source.skip(100_000)).toBe(5000 - 1210);
		expect(source.ended).toBe(true);
	});

	it("cancel kills the process and settles", async () => {
		const source = createFfmpegPcmSource(
			node(frameWriter(PCM_SAMPLE_RATE * 600)),
		);
		await source.ready(4096);
		const pid = source.pid as number;
		expect(isAlive(pid)).toBe(true);

		await source.cancel();

		expect(isAlive(pid)).toBe(false);
		expect(source.pull(10)).toBeNull();
		await source.cancel();
	});

	it("reports a failing process as a typed error with its stderr", async () => {
		const source = createFfmpegPcmSource(
			node("process.stderr.write('boom happened'); process.exit(3)"),
		);
		await source.closed;
		expect(source.ended).toBe(true);
		expect(source.error).toBeInstanceOf(MediaError);
		expect((source.error as MediaError).code).toBe("process-failed");
		expect((source.error as MediaError).details).toMatchObject({
			exitCode: 3,
			stderr: "boom happened",
		});
	});

	it("reports a missing binary", async () => {
		const source = createFfmpegPcmSource({
			ffmpegPath: "definitely-not-a-binary-xyz",
			args: [],
		});
		await source.closed;
		expect((source.error as MediaError).code).toBe("binary-not-found");
	});
});
