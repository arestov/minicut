import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import { type AudioSinkContext, createAudioSink } from "./audioSink";
import { createPcmBuffer } from "./pcmBuffer";
import { PCM_SAMPLE_RATE, type PcmSource } from "./pcmSource";

/** Finished stream of `frames` frames: left = ramp in [0, 0.5), right = -left. */
const rampSource = (frames: number): PcmSource => {
	const buffer = createPcmBuffer();
	const data = new Float32Array(frames * 2);
	for (let i = 0; i < frames; i += 1) {
		const value = ((i % 4000) / 4000) * 0.5;
		data[2 * i] = value;
		data[2 * i + 1] = -value;
	}
	buffer.push(new Uint8Array(data.buffer));
	return {
		get bufferedFrames() {
			return buffer.frames;
		},
		get ended() {
			return buffer.frames === 0;
		},
		error: null,
		pull: (count) =>
			buffer.frames >= count
				? buffer.take(count)
				: buffer.frames > 0
					? buffer.take(buffer.frames)
					: null,
		skip: (count) => {
			const dropped = Math.min(count, buffer.frames);
			if (dropped > 0) buffer.take(dropped);
			return dropped;
		},
		ready: () => Promise.resolve(),
		cancel: () => Promise.resolve(),
	};
};

const renderThroughSink = async (frames: number, masterGain?: number) => {
	const context = new OfflineAudioContext(2, frames + PCM_SAMPLE_RATE / 10, PCM_SAMPLE_RATE);
	const sink = createAudioSink({
		context: context as unknown as AudioSinkContext,
		// The whole stream is scheduled in one pass; no timers involved.
		lookaheadSeconds: frames / PCM_SAMPLE_RATE + 1,
		startLeadSeconds: 0.01,
		timers: {
			repeat: () => 0,
			cancelRepeat: () => undefined,
			after: () => 0,
		},
	});
	if (masterGain !== undefined) sink.setMasterGain(masterGain);
	sink.play({ cursorSeconds: 0, open: () => rampSource(frames) });
	const rendered = await context.startRendering();
	return {
		left: rendered.getChannelData(0),
		right: rendered.getChannelData(1),
		stats: sink.stats(),
	};
};

describe("audio sink offline render", () => {
	const lead = PCM_SAMPLE_RATE / 100;
	const frames = PCM_SAMPLE_RATE * 2 + 123;

	it("reproduces the PCM stream sample-exactly: no gaps, overlaps or reordering across 20 ms chunk joins", async () => {
		const { left, right, stats } = await renderThroughSink(frames);

		expect(stats.scheduledChunks).toBe(Math.ceil(frames / 960));
		for (let i = 0; i < lead; i += 1) expect(Math.abs(left[i] as number)).toBeLessThan(1e-9);
		let wrong = 0;
		for (let i = 0; i < frames; i += 1) {
			const expected = Math.fround(((i % 4000) / 4000) * 0.5);
			// The gain stage leaves rounding noise around 1e-13; joins are off by a whole sample otherwise.
			if (
				Math.abs((left[lead + i] as number) - expected) > 1e-9 ||
				Math.abs((right[lead + i] as number) + expected) > 1e-9
			) {
				wrong += 1;
			}
		}
		expect(wrong).toBe(0);
		expect(Math.abs(left[lead + frames] as number)).toBeLessThan(1e-9);
	});

	it("applies the master gain to everything the sink plays", async () => {
		const { left } = await renderThroughSink(PCM_SAMPLE_RATE, 0.5);
		const index = lead + 3000;
		expect(left[index]).toBeCloseTo((((3000 % 4000) / 4000) * 0.5) * 0.5, 6);
	});
});
