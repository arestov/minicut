import { describe, expect, it } from "vitest";
import {
	CONTENT_ASPECT,
	PARITY_FILES,
	PARITY_STEPS,
	containedRect,
	findClip,
	isSnapshotComplete,
	snapshotFromGraphDump,
} from "./sharedScenario";

const dump = (clipAttrs: Record<string, unknown> = {}) => ({
	rootNodeId: "root",
	nodes: [
		{ nodeId: "root", modelName: "session_root", attrs: { cursor: 1.23456, isPlaying: false, selectedEntityId: "c2" }, rels: { activeProject: "p" } },
		{ nodeId: "p", modelName: "project", attrs: { fps: 30, width: 1920, height: 1080, title: "Project 3" }, rels: { tracks: ["t1"], resources: ["r1"] } },
		{ nodeId: "t1", modelName: "track", attrs: { name: "V1", kind: "video" }, rels: { clips: ["c1", "c2"] } },
		{
			nodeId: "c1",
			modelName: "clip",
			attrs: { name: "a.webm", mediaKind: "video", start: 0, in: 0, duration: 2.0084, fadeIn: 0, fadeOut: 0, audio: { gain: 1, pan: 0 }, opacity: { value: 1 }, ...clipAttrs },
			rels: { resource: "r1" },
		},
		{
			nodeId: "c2",
			modelName: "clip",
			attrs: { name: "a.webm", mediaKind: "video", start: 2, in: 0, duration: 1, fadeIn: 0, fadeOut: 0, audio: { gain: 0.5, pan: 0 }, opacity: { value: 0.5 } },
			rels: { resource: "r1" },
		},
		{ nodeId: "r1", modelName: "resource", attrs: { name: "a.webm", kind: "video", duration: 2.008, url: "blob:x", assetRef: "a" }, rels: {} },
	],
});

describe("parity scenario data", () => {
	it("only imports and places files the scenario declares, and every frame name is unique", () => {
		const names = new Set<string>(PARITY_FILES.map((file) => file.name));
		for (const step of PARITY_STEPS) {
			if (step.op === "import") for (const file of step.files) expect(names.has(file)).toBe(true);
			if (step.op === "addToTimeline") expect(names.has(step.resource)).toBe(true);
		}
		const frames = PARITY_STEPS.flatMap((step) => (step.op === "frame" ? [step.name] : []));
		expect(new Set(frames).size).toBe(frames.length);
		const checkpoints = PARITY_STEPS.flatMap((step) => (step.op === "checkpoint" ? [step.name] : []));
		expect(new Set(checkpoints).size).toBe(checkpoints.length);
	});

	it("ends with an export and has unique export names", () => {
		const ops = PARITY_STEPS.map((step) => step.op);
		const exports = PARITY_STEPS.flatMap((step) => (step.op === "export" ? [step.name] : []));
		expect(exports.length).toBeGreaterThan(0);
		expect(new Set(exports).size).toBe(exports.length);
		expect(ops[ops.length - 1]).toBe("export");
	});
});

describe("snapshotFromGraphDump", () => {
	it("keeps what the user sees, rounds numbers and drops ids, urls and titles", () => {
		const snapshot = snapshotFromGraphDump(dump());
		expect(snapshot).toEqual({
			project: { fps: 30, width: 1920, height: 1080 },
			tracks: [
				{
					name: "V1",
					kind: "video",
					clips: [
						{ name: "a.webm", mediaKind: "video", resource: "a.webm", start: 0, in: 0, duration: 2.008, fadeIn: 0, fadeOut: 0, gain: 1, pan: 0, opacity: 1 },
						{ name: "a.webm", mediaKind: "video", resource: "a.webm", start: 2, in: 0, duration: 1, fadeIn: 0, fadeOut: 0, gain: 0.5, pan: 0, opacity: 0.5 },
					],
				},
			],
			resources: [{ name: "a.webm", kind: "video", duration: 2.008 }],
			session: { cursor: 1.235, isPlaying: false, selectedClip: { track: "V1", name: "a.webm", nth: 1 } },
		});
		expect(JSON.stringify(snapshot)).not.toContain("blob:");
	});

	it("reports an incomplete snapshot until clip numbers have arrived", () => {
		expect(isSnapshotComplete(snapshotFromGraphDump(dump()))).toBe(true);
		expect(isSnapshotComplete(snapshotFromGraphDump(dump({ start: undefined })))).toBe(false);
		expect(isSnapshotComplete(snapshotFromGraphDump(null))).toBe(false);
	});

	it("finds the n-th clip of a name on a track", () => {
		const snapshot = snapshotFromGraphDump(dump());
		expect(findClip(snapshot, { track: "V1", name: "a.webm", nth: 1 })?.start).toBe(2);
		expect(findClip(snapshot, { track: "V2", name: "a.webm" })).toBeNull();
	});
});

describe("containedRect", () => {
	it("centres the 4:3 picture in a wide and in a 16:9 box", () => {
		expect(containedRect(960, 540)).toEqual({ x: 120, y: 0, width: 720, height: 540 });
		const wide = containedRect(653, 205);
		expect(wide.width / wide.height).toBeCloseTo(CONTENT_ASPECT, 5);
		expect(wide.x * 2 + wide.width).toBeCloseTo(653, 5);
	});
});
