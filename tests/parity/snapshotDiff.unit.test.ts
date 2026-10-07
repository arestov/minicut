import { describe, expect, it } from "vitest";
import { diffSnapshots } from "./snapshotDiff";
import type { ParityClip, ParitySnapshot } from "./sharedScenario";

const clip = (overrides: Partial<ParityClip> = {}): ParityClip => ({
	name: "a.webm",
	mediaKind: "video",
	resource: "a.webm",
	start: 0,
	in: 0,
	duration: 2,
	fadeIn: 0,
	fadeOut: 0,
	gain: 1,
	pan: 0,
	opacity: 1,
	...overrides,
});

const snapshot = (clips: ParityClip[] = [clip()], duration = 2): ParitySnapshot => ({
	project: { fps: 30, width: 1920, height: 1080 },
	tracks: [{ name: "V1", kind: "video", clips }],
	resources: [{ name: "a.webm", kind: "video", duration }],
	session: { cursor: 1, isPlaying: false, selectedClip: null },
});

describe("diffSnapshots", () => {
	it("is empty for equal snapshots and for times within the tolerance", () => {
		expect(diffSnapshots(snapshot(), snapshot(), 0.02)).toEqual([]);
		expect(diffSnapshots(snapshot([clip({ duration: 2.008 })], 2.008), snapshot(), 0.02)).toEqual([]);
	});

	it("names every differing field", () => {
		const diffs = diffSnapshots(snapshot([clip({ start: 0.5, opacity: 0.5 })]), snapshot(), 0.02);
		expect(diffs).toEqual([
			'V1[0] a.webm.start: web 0.5 != desktop 0',
			'V1[0] a.webm.opacity: web 0.5 != desktop 1',
		]);
	});

	it("reports a different clip count and a different resource duration beyond the tolerance", () => {
		const diffs = diffSnapshots(snapshot([clip(), clip({ start: 2 })], 3), snapshot(), 0.02);
		expect(diffs).toContain("V1 clip count: web 2 != desktop 1");
		expect(diffs).toContain("resource a.webm.duration: web 3 != desktop 2");
	});

	it("compares the session: cursor, playing flag and selected clip", () => {
		const web = snapshot();
		web.session = { cursor: 1.6, isPlaying: true, selectedClip: { track: "V1", name: "a.webm", nth: 0 } };
		expect(diffSnapshots(web, snapshot(), 0.02)).toEqual([
			"session.cursor: web 1.6 != desktop 1",
			"session.isPlaying: web true != desktop false",
			'session.selectedClip: web {"track":"V1","name":"a.webm","nth":0} != desktop null',
		]);
	});
});
