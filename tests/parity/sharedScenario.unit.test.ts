import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import { ReactSyncReceiver } from "../../src/dkt-ui-sync/receiver/ReactSyncReceiver";
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

type TestDump = { rootNodeId: string; nodes: Array<{ nodeId: string; modelName: string; attrs: Record<string, unknown>; rels: Record<string, unknown> }> };
const inspectorAttrs = { color: "#2563eb", transform: { x: { value: 0 }, y: { value: 0 }, scale: { value: 1 }, rotation: { value: 0 } }, $meta$rels$effects$exists: false, $meta$rels$colorCorrectionEffects$exists: false };
const dump = (clipAttrs: Record<string, unknown> = {}): TestDump => ({
	rootNodeId: "root",
	nodes: [
		{ nodeId: "root", modelName: "session_root", attrs: { cursor: 1.23456, isPlaying: false, selectedEntityId: "c2", activeInspectorTab: "edit" }, rels: { activeProject: "p" } },
		{ nodeId: "p", modelName: "project", attrs: { fps: 30, width: 1920, height: 1080, title: "Project 3" }, rels: { tracks: ["t1"], resources: ["r1"] } },
		{ nodeId: "t1", modelName: "track", attrs: { name: "V1", kind: "video" }, rels: { clips: ["c1", "c2"] } },
		{
			nodeId: "c1",
			modelName: "clip",
			attrs: { name: "a.webm", mediaKind: "video", start: 0, in: 0, duration: 2.0084, fadeIn: 0, fadeOut: 0, audio: { gain: 1, pan: 0 }, opacity: { value: 1 }, ...inspectorAttrs, ...clipAttrs },
			rels: { resource: "r1", effects: [], colorCorrectionEffects: [] },
		},
		{
			nodeId: "c2",
			modelName: "clip",
			attrs: { name: "a.webm", mediaKind: "video", start: 2, in: 0, duration: 1, fadeIn: 0, fadeOut: 0, audio: { gain: 0.5, pan: 0 }, opacity: { value: 0.5 }, ...inspectorAttrs },
			rels: { resource: "r1", effects: [], colorCorrectionEffects: [] },
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
						{ name: "a.webm", mediaKind: "video", resource: "a.webm", start: 0, in: 0, duration: 2.008, fadeIn: 0, fadeOut: 0, gain: 1, pan: 0, opacity: 1, color: "#2563eb", transform: { x: 0, y: 0, scale: 1, rotation: 0 }, effects: [], correctionEffectIndices: [], hasColorCorrection: false },
						{ name: "a.webm", mediaKind: "video", resource: "a.webm", start: 2, in: 0, duration: 1, fadeIn: 0, fadeOut: 0, gain: 0.5, pan: 0, opacity: 0.5, color: "#2563eb", transform: { x: 0, y: 0, scale: 1, rotation: 0 }, effects: [], correctionEffectIndices: [], hasColorCorrection: false },
					],
				},
			],
			resources: [{ name: "a.webm", kind: "video", duration: 2.008 }],
			session: { activeInspectorTab: "edit", cursor: 1.235, isPlaying: false, selectedClip: { track: "V1", name: "a.webm", nth: 1 } },
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

const correctionDump = (): TestDump => {
 const graph = dump(); const clip = graph.nodes.find(node => node.nodeId === "c1")!;
 clip.rels.effects = ["fx-blur", "fx-grade-a", "fx-grade-b"];
 clip.rels.colorCorrectionEffects = ["fx-grade-a", "fx-grade-b"];
 clip.attrs.$meta$rels$effects$exists = true;
 clip.attrs.$meta$rels$colorCorrectionEffects$exists = true;
 for (const [nodeId, kind, params] of [["fx-blur", "blur", {}], ["fx-grade-a", "color-correction", { exposure: { value: 0.25 } }], ["fx-grade-b", "color-correction", { exposure: { value: -0.2 } }]] as const) graph.nodes.push({ nodeId, modelName: "effect", attrs: { name: "Duplicate label", kind, enabled: false, params }, rels: {} });
 return graph;
};

it("normalizes all ordered raw/projection identities without IDs and accepts false plus empty params", () => {
 const snapshot = snapshotFromGraphDump(correctionDump()); const clip = snapshot.tracks[0].clips[0];
 expect(clip.correctionEffectIndices).toEqual([1, 2]); expect(clip.hasColorCorrection).toBe(true);
 expect(clip.effects?.map(effect => effect.kind)).toEqual(["blur", "color-correction", "color-correction"]);
 expect(clip.effects?.map(effect => effect.enabled)).toEqual([false, false, false]); expect(clip.effects?.[0].params).toEqual({});
 expect(isSnapshotComplete(snapshot)).toBe(true); expect(JSON.stringify(snapshot)).not.toContain("fx-grade");
 expect(snapshotFromGraphDump(dump({ transform: { x: { value: 1.23456 } } })).tracks[0].clips[0].transform).toEqual({ x: 1.235, y: null, scale: null, rotation: null });
});

it.each(["color", "transform", "in", "fadeIn", "fadeOut", "audio", "$meta$rels$colorCorrectionEffects$exists"])("waits for missing Clip %s", field => {
 expect(isSnapshotComplete(snapshotFromGraphDump(dump({ [field]: undefined })))).toBe(false);
});

it.each(["effects", "colorCorrectionEffects"])("keeps missing %s distinct from empty relation", rel => {
 const graph = dump(); const clip = graph.nodes.find(node => node.nodeId === "c1")!; delete clip.rels[rel];
 clip.attrs[`$meta$rels$${rel}$exists`] = undefined;
 const snapshot = snapshotFromGraphDump(graph); expect(isSnapshotComplete(snapshot)).toBe(false);
 expect(rel === "effects" ? snapshot.tracks[0].clips[0].effects : snapshot.tracks[0].clips[0].correctionEffectIndices).toBeNull();
});

it.each(["enabled", "params", "name", "kind"])("waits for late Effect %s", field => {
 const graph = correctionDump(); delete graph.nodes.find(node => node.nodeId === "fx-grade-b")!.attrs[field];
 expect(isSnapshotComplete(snapshotFromGraphDump(graph))).toBe(false);
});

it.each([undefined, "wrong"])("waits for a canonical inspector tab %s", tab => {
 const graph = dump(); graph.nodes[0].attrs.activeInspectorTab = tab; expect(isSnapshotComplete(snapshotFromGraphDump(graph))).toBe(false);
});

it.each([
 { label: "stale empty projection and false meta", ids: [], exists: false },
 { label: "partial projection", ids: ["fx-grade-a"], exists: true },
 { label: "wrong order", ids: ["fx-grade-b", "fx-grade-a"], exists: true },
 { label: "duplicate projected identity", ids: ["fx-grade-a", "fx-grade-a"], exists: true },
 { label: "nonmember identity", ids: ["missing", "fx-grade-b"], exists: true },
 { label: "wrong raw kind membership", ids: ["fx-blur", "fx-grade-b"], exists: true },
 { label: "stale false metadata", ids: ["fx-grade-a", "fx-grade-b"], exists: false },
])("rejects $label even when raw effects are ready", ({ ids, exists }) => {
 const graph = correctionDump(); const clip = graph.nodes.find(node => node.nodeId === "c1")!;
 clip.rels.colorCorrectionEffects = ids; clip.attrs.$meta$rels$colorCorrectionEffects$exists = exists;
 expect(isSnapshotComplete(snapshotFromGraphDump(graph))).toBe(false);
});

it("does not accept one ready raw grade with stale empty projection and false metadata", () => {
 const graph = correctionDump(); const clip = graph.nodes.find(node => node.nodeId === "c1")!;
 clip.rels.effects = ["fx-grade-a"]; clip.rels.colorCorrectionEffects = []; clip.attrs.$meta$rels$colorCorrectionEffects$exists = false;
 const snapshot = snapshotFromGraphDump(graph);
 expect(snapshot.tracks[0].clips[0].effects).toHaveLength(1);
 expect(snapshot.tracks[0].clips[0].correctionEffectIndices).toEqual([]);
 expect(isSnapshotComplete(snapshot)).toBe(false);
});

it("recognizes public receiver null-wire loaded empty effect relations", () => {
 const receiver = new ReactSyncReceiver(null);
 receiver.handleSync(SYNCR_TYPES.SET_DICT, [undefined, "effects", "colorCorrectionEffects", "$meta$rels$effects$exists", "$meta$rels$colorCorrectionEffects$exists"]);
 receiver.handleSync(SYNCR_TYPES.TREE_ROOT, { node_id: "c1", data: [null, null, null] });
 receiver.handleSync(SYNCR_TYPES.UPDATE, [1, "c1", 1, null, 1, "c1", 2, null, 0, "c1", 4, 3, false, 4, false]);
 const root = receiver.getRootScope();
 if (!root) throw new Error("Expected receiver root");
 expect(receiver.readManyScopes(root, "effects")).toEqual([]);
 expect(receiver.readManyScopes(root, "colorCorrectionEffects")).toEqual([]);
 const received = receiver.debugDescribeNode("c1");
 if (!received) throw new Error("Expected received Clip");
 const graph = dump(); const clip = graph.nodes.find(node => node.nodeId === "c1")!;
 delete clip.rels.effects; delete clip.rels.colorCorrectionEffects;
 Object.assign(clip.attrs, received.attrs); Object.assign(clip.rels, received.rels);
 const snapshot = snapshotFromGraphDump(graph);
 expect(snapshot.tracks[0].clips[0].effects).toEqual([]);
 expect(snapshot.tracks[0].clips[0].correctionEffectIndices).toEqual([]);
 expect(snapshot.tracks[0].clips[0].hasColorCorrection).toBe(false);
 expect(isSnapshotComplete(snapshot)).toBe(true);
});
it.each(["effects", "colorCorrectionEffects"])("uses only authoritative false metadata for omitted/null %s", rel => {
 for (const value of [undefined, null]) for (const exists of [undefined, true, false]) {
  const graph = dump(); const clip = graph.nodes.find(node => node.nodeId === "c1")!;
  if (value === undefined) delete clip.rels[rel]; else clip.rels[rel] = value;
  clip.attrs[`$meta$rels$${rel}$exists`] = exists;
  const snapshot = snapshotFromGraphDump(graph);
  expect(isSnapshotComplete(snapshot)).toBe(exists === false);
  expect(rel === "effects" ? snapshot.tracks[0].clips[0].effects : snapshot.tracks[0].clips[0].correctionEffectIndices).toEqual(exists === false ? [] : null);
 }
});

it.each(["effects", "colorCorrectionEffects"])("rejects invalid many %s even with false metadata", rel => {
 for (const value of ["invalid", {}]) {
  const graph = dump(); graph.nodes.find(node => node.nodeId === "c1")!.rels[rel] = value;
  expect(isSnapshotComplete(snapshotFromGraphDump(graph))).toBe(false);
 }
});