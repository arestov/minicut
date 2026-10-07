// Stage 4-audio measurement (run with bun, needs an audio device and ffmpeg on PATH or MINICUT_FFMPEG_PATH):
//   bun scripts/audio-spike/measure-seek.ts [seeks]
// Seek-to-sound latency of the production audio path: direct ffmpeg stream (respawn per seek) versus the
// rendered PCM mix cache. Sound is detected on an AnalyserNode between the sink and the device.
import path from "node:path";
import { createAudioSink } from "../../src/video-editor/media/node/audio/audioSink";
import { createNodeAudioContext } from "../../src/video-editor/media/node/audio/nodeAudioContext";
import { createPcmMixCache } from "../../src/video-editor/media/node/audio/pcmMixCache";
import { createMediaService } from "../../src/video-editor/media/node/mediaService";
import type { AudioMixDescriptor } from "../../src/video-editor/media/contracts/audioStream";

const fixtures = path.resolve(import.meta.dirname, "../../tmp/media-fixtures/v1");
const seeks = Number(process.argv[2] ?? 10);
const clipSeconds = 2;
const clipCount = 60;

const clip = (index: number) => ({
	id: `a${index}`,
	name: "Clip",
	resourceId: index % 2 === 0 ? "tone" : "av",
	resourceKind: "audio",
	start: index * clipSeconds,
	duration: clipSeconds,
	inPoint: 0,
	audio: { gain: 0.8, pan: 0 },
});

const mix: AudioMixDescriptor = {
	plan: {
		projectId: "measure",
		fps: 30,
		width: 640,
		height: 360,
		duration: clipSeconds * clipCount,
		clipSources: Array.from({ length: clipCount }, (_, index) => clip(index)),
	} as unknown as AudioMixDescriptor["plan"],
	assets: {
		tone: { path: path.join(fixtures, "audio-tone.wav") },
		av: { path: path.join(fixtures, "video-audio.mp4") },
	},
	audioChannels: {},
	silentAudioResources: [],
};

const media = createMediaService();
const context = await createNodeAudioContext();
const analyser = context.createAnalyser();
analyser.fftSize = 256;
analyser.connect(context.destination);
const probeContext = new Proxy(context, {
	get(target, key) {
		if (key === "destination") return analyser;
		const value = Reflect.get(target, key, target);
		return typeof value === "function" ? value.bind(target) : value;
	},
});
const sink = createAudioSink({ context: probeContext as never });
const samples = new Float32Array(256);
const audible = (): boolean => {
	analyser.getFloatTimeDomainData(samples);
	return samples.some((value) => Math.abs(value) > 1e-4);
};
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const cache = createPcmMixCache({
	dir: path.join(process.env.TEMP ?? ".", "minicut-measure-audio-mix"),
	openStream: (request) => media.streamAudioMix(request),
});
const renderStarted = performance.now();
cache.prepare(mix);
await cache.idle();
const renderMs = performance.now() - renderStarted;

const measure = async (useCache: boolean) => {
	const rows: number[] = [];
	for (let index = 0; index < seeks; index += 1) {
		sink.stop();
		await wait(120);
		const cursor = 5 + index * 7.3;
		const started = performance.now();
		sink.play({
			cursorSeconds: cursor,
			open: (startSeconds) =>
				(useCache ? cache.open(mix, startSeconds) : null) ??
				media.streamAudioMix({ ...mix, startSeconds }),
		});
		while (!audible()) await wait(1);
		rows.push(performance.now() - started);
		await wait(150);
	}
	sink.stop();
	const sorted = [...rows].sort((a, b) => a - b);
	return {
		avg: +(rows.reduce((a, b) => a + b, 0) / rows.length).toFixed(1),
		median: +(sorted[Math.floor(sorted.length / 2)] as number).toFixed(1),
		max: +Math.max(...rows).toFixed(1),
	};
};

await measure(false); // warm the disk cache and ffmpeg
const direct = await measure(false);
const cached = await measure(true);
console.log(
	JSON.stringify({
		seeks,
		timelineSeconds: clipSeconds * clipCount,
		outputLatencyMs: +(context.outputLatency * 1000).toFixed(1),
		cacheRenderMs: +renderMs.toFixed(0),
		cacheFrames: cache.status()?.writtenFrames,
		seekToSoundMs: { directStream: direct, pcmCache: cached },
		sink: sink.stats(),
	}),
);
await cache.dispose();
await context.close();
process.exit(0);
