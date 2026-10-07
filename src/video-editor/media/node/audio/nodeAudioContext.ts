import type { AudioClockSource } from "./audioPlaybackClock";
import type { AudioSinkContext } from "./audioSink";
import { PCM_SAMPLE_RATE } from "./pcmSource";

/** Real output context: what the sink and the clock need, plus lifecycle. */
export type NodeAudioContext = AudioSinkContext &
	AudioClockSource & {
		/** Resolves when the device is running (or rejects). */
		resume(): Promise<void>;
		close(): Promise<void>;
		/** `statechange` notifications (device lost, suspended, resumed). */
		onstatechange: ((event: unknown) => void) | null;
	};

/**
 * Opens the default output device through `node-web-audio-api` (WASAPI,
 * CoreAudio, ALSA). The native addon is loaded lazily so hosts without audio
 * (tests, headless) never touch it. Throws when there is no usable device;
 * the host decides to continue on the system clock without sound.
 */
export const createNodeAudioContext = async (): Promise<NodeAudioContext> => {
	const { AudioContext } = await import("node-web-audio-api");
	const context = new AudioContext({
		latencyHint: "playback",
		sampleRate: PCM_SAMPLE_RATE,
	});
	if (context.sampleRate !== PCM_SAMPLE_RATE) {
		await context.close();
		throw new Error(
			`Audio device opened at ${context.sampleRate} Hz, expected ${PCM_SAMPLE_RATE} Hz`,
		);
	}
	return context as unknown as NodeAudioContext;
};
