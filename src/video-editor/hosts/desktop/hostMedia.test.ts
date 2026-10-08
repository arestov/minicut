import { describe, expect, it } from "vitest";
import type { ProbeAudioStream, ProbeResult, ProbeVideoStream } from "../../media/contracts/probe";
import { classifyProbe, technicalMetadataFromProbe } from "./hostMedia";

const videoStream: ProbeVideoStream = { kind: "video", index: 0, codec: "h264", width: 320, height: 240, fps: 25, nominalFps: 25, variableFrameRate: false, durationSeconds: 2, frameCount: 50, startTimeSeconds: 0, rotation: 0 };
const audioStream = (index: number): ProbeAudioStream => ({ kind: "audio", index, codec: "aac", sampleRate: 48000, channels: 2, durationSeconds: 2, startTimeSeconds: 0 });
const probeOf = (streams: Array<ProbeVideoStream | ProbeAudioStream>): ProbeResult => ({
	requestId: "r", path: "x.mp4", formatName: "mov,mp4", durationSeconds: 2, startTimeSeconds: 0, sizeBytes: 1, streams,
	video: streams.find((s): s is ProbeVideoStream => s.kind === "video") ?? null,
	audio: streams.find((s): s is ProbeAudioStream => s.kind === "audio") ?? null,
});

describe("technicalMetadataFromProbe audio streams", () => {
	it("reports a known zero for a video without an audio stream", () => {
		const probe = probeOf([videoStream]);
		const metadata = technicalMetadataFromProbe(probe, classifyProbe(probe) ?? "video");
		expect(metadata.streams).toEqual({ videoStreams: 1, audioStreams: 0 });
		expect(metadata.audioChannels).toBeNull();
	});

	it("counts every audio stream of a video", () => {
		const probe = probeOf([videoStream, audioStream(1), audioStream(2)]);
		const metadata = technicalMetadataFromProbe(probe, "video");
		expect(metadata.streams.audioStreams).toBe(2);
		expect(metadata.audioChannels).toBe(2);
		expect(metadata.audioSampleRate).toBe(48000);
	});

	it("keeps one audio stream for an audio file and unknown for an image", () => {
		expect(technicalMetadataFromProbe(probeOf([audioStream(0)]), "audio").streams.audioStreams).toBe(1);
		expect(technicalMetadataFromProbe(probeOf([videoStream]), "image").streams.audioStreams).toBeNull();
	});
});
