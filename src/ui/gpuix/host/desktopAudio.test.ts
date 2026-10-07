import { expect, test } from "bun:test";
import type { AudioMixDescriptor } from "../../../video-editor/media/contracts/audioStream";
import { createEmptyPcmSource, type PcmSource } from "../../../video-editor/media/node/audio/pcmSource";
import type { PlaybackClock } from "../../../video-editor/playback/playbackRuntime";
import type { AudioMixController } from "./audioMixController";
import { createDesktopAudio, type DesktopAudioContext } from "./desktopAudio";

const fakeContext = () => {
	const node = () => ({
		connect: () => undefined,
		disconnect: () => undefined,
		gain: {
			value: 1,
			cancelScheduledValues: () => undefined,
			setValueAtTime: () => undefined,
			linearRampToValueAtTime: () => undefined,
		},
		buffer: null,
		start: () => undefined,
		stop: () => undefined,
	});
	const context = {
		currentTime: 0,
		sampleRate: 48_000,
		outputLatency: 0.01,
		state: "running",
		destination: "destination",
		onstatechange: null as ((event: unknown) => void) | null,
		createGain: node,
		createBufferSource: node,
		createBuffer: () => ({ copyToChannel: () => undefined }),
		close: () => Promise.resolve(),
	};
	return context as unknown as DesktopAudioContext & {
		currentTime: number;
		state: string;
	};
};

const mixOf = (): AudioMixDescriptor => ({
	plan: { projectId: "p", fps: 30, width: 2, height: 2, duration: 5, clipSources: [] },
	assets: {},
	audioChannels: {},
	silentAudioResources: [],
});

const fakeMix = (initial: AudioMixDescriptor | null) => {
	let mix = initial;
	const listeners = new Set<() => void>();
	const controller: AudioMixController = {
		updatePlan: () => undefined,
		refreshAssets: () => undefined,
		current: () => mix,
		idle: () => Promise.resolve(),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: () => undefined,
	};
	return {
		controller,
		set(next: AudioMixDescriptor | null) {
			mix = next;
			for (const listener of listeners) listener();
		},
	};
};

const systemClock = (): PlaybackClock & { now: number } => {
	const clock = {
		now: 5_000,
		nowEpochMs: () => 1_700_000_000_000 + clock.now,
		nowMonotonicMs: () => clock.now,
		requestFrame: () => 1,
		cancelFrame: () => undefined,
	};
	return clock;
};

const setup = (mix: AudioMixDescriptor | null = mixOf()) => {
	const context = fakeContext();
	const fallback = systemClock();
	const mixes = fakeMix(mix);
	const opened: Array<{ startSeconds: number }> = [];
	const audio = createDesktopAudio({
		context,
		mix: mixes.controller,
		fallbackClock: fallback,
		systemMonotonicMs: () => fallback.now,
		openStream: (request) => {
			opened.push({ startSeconds: request.startSeconds });
			return createEmptyPcmSource() as PcmSource;
		},
	});
	const changes: string[] = [];
	audio.subscribe((change) => changes.push(change));
	return { context, fallback, mixes, opened, audio, changes };
};

test("the clock follows the audio device while it runs and the system clock otherwise, announcing each switch", () => {
	const { context, fallback, audio, changes } = setup();
	context.currentTime = 10;
	const running = audio.clock.nowMonotonicMs();
	// audio time minus the latency estimate (sampled once: 10 ms)
	expect(running).toBeCloseTo(9990, 0);

	context.state = "suspended";
	context.onstatechange?.({});
	expect(changes).toEqual(["clock"]);
	expect(audio.clock.nowMonotonicMs()).toBe(fallback.now);

	context.state = "running";
	context.onstatechange?.({});
	expect(changes).toEqual(["clock", "clock"]);
	// No announcement for a state event that changes nothing.
	context.onstatechange?.({});
	expect(changes).toHaveLength(2);
});

test("start opens the mix stream at cursor + start lead + output latency", () => {
	const { context, audio, opened } = setup();
	audio.clock.nowMonotonicMs(); // samples the latency estimate

	audio.start(12);

	expect(opened).toHaveLength(1);
	expect(opened[0]?.startSeconds).toBeCloseTo(12 + 0.02 + 0.01, 6);
	audio.stop();
	expect(context.state).toBe("running");
});

test("start without a mix or on a lost device opens nothing", () => {
	const noMix = setup(null);
	noMix.audio.start(3);
	expect(noMix.opened).toEqual([]);

	const lost = setup();
	lost.context.state = "suspended";
	lost.context.onstatechange?.({});
	lost.audio.start(3);
	expect(lost.opened).toEqual([]);
});

test("a changed mix is announced; losing the device stops the sound", () => {
	const { context, mixes, audio, changes, opened } = setup();
	audio.start(1);
	expect(opened).toHaveLength(1);

	mixes.set(mixOf());
	expect(changes).toEqual(["mix"]);

	context.state = "suspended";
	context.onstatechange?.({});
	expect(changes).toEqual(["mix", "clock"]);
});

test("dispose releases the device and detaches listeners", async () => {
	const { context, mixes, audio, changes } = setup();
	await audio.dispose();
	mixes.set(mixOf());
	expect(changes).toEqual([]);
	expect(context.onstatechange).toBeNull();
});
