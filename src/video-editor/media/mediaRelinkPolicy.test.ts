import { describe, expect, it } from "vitest";
import { calculateDurationTolerance, evaluateRelinkCandidate, type MediaTechnicalMetadata } from "./mediaRelinkPolicy";

const video = (overrides: Partial<MediaTechnicalMetadata> = {}): MediaTechnicalMetadata => ({
	kind: "video", duration: 10, frameRate: 30, timebase: 1 / 30,
	width: 1920, height: 1080, audioChannels: 2, audioSampleRate: 48_000,
	streams: { videoStreams: 1, audioStreams: 1 }, ...overrides,
});

describe("evaluateRelinkCandidate", () => {
	it.each(["same-entry", "fingerprint-match"] as const)("accepts %s as exact", (identity) => {
		expect(evaluateRelinkCandidate({ original: video(), candidate: video(), requiredSourceEnd: 9, identity }).classification).toBe("exact-match");
	});

	it("does not infer identity from matching duration", () => {
		const result = evaluateRelinkCandidate({ original: video(), candidate: video(), requiredSourceEnd: 9, identity: "mismatch" });
		expect(result).toMatchObject({ classification: "compatible-replacement", requiresConfirmation: true, reasons: ["identity-mismatch"] });
	});

	it("rejects a candidate shorter than the used source range", () => {
		const result = evaluateRelinkCandidate({ original: video(), candidate: video({ duration: 7 }), requiredSourceEnd: 8, identity: "same-entry" });
		expect(result.classification).toBe("incompatible");
		expect(result.reasons).toContain("source-range-too-short");
	});

	it("requires confirmation for a longer non-identical candidate", () => {
		expect(evaluateRelinkCandidate({ original: video(), candidate: video({ duration: 12 }), requiredSourceEnd: 9, identity: "metadata-only" })).toMatchObject({ classification: "compatible-replacement", requiresConfirmation: true });
	});

	it.each([
		[video({ kind: "audio" }), "media-kind-mismatch"],
		[video({ streams: { videoStreams: 1, audioStreams: 0 } }), "stream-topology-mismatch"],
	] as const)("rejects incompatible topology", (candidate, reason) => {
		const result = evaluateRelinkCandidate({ original: video(), candidate, requiredSourceEnd: 8, identity: "same-entry" });
		expect(result).toMatchObject({ classification: "incompatible" });
		expect(result.reasons).toContain(reason);
	});

	it("reports technical differences as stable warnings", () => {
		const candidate = video({ frameRate: 24, timebase: 1 / 24, width: 1280, audioSampleRate: 44_100 });
		expect(evaluateRelinkCandidate({ original: video(), candidate, requiredSourceEnd: 8, identity: "mismatch" }).reasons).toEqual(expect.arrayContaining(["frame-rate-differs", "timebase-differs", "dimensions-differ", "audio-properties-differ"]));
	});

	it("uses a two-frame range tolerance", () => {
		expect(calculateDurationTolerance(30)).toBeCloseTo(2 / 30);
		expect(evaluateRelinkCandidate({ original: video(), candidate: video({ duration: 9.95 }), requiredSourceEnd: 10, identity: "same-entry" }).classification).toBe("exact-match");
		expect(evaluateRelinkCandidate({ original: video(), candidate: video({ duration: 9.9 }), requiredSourceEnd: 10, identity: "same-entry" }).classification).toBe("incompatible");
	});

	it.each([NaN, Infinity, -1])("fails closed for invalid duration %s", (duration) => {
		expect(evaluateRelinkCandidate({ original: video(), candidate: video({ duration }), requiredSourceEnd: 1, identity: "same-entry" })).toMatchObject({ classification: "incompatible", reasons: ["invalid-metadata"] });
	});
});
