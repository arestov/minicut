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
 color: "#2563eb", transform: { x: 0, y: 0, scale: 1, rotation: 0 }, effects: [], correctionEffectIndices: [], hasColorCorrection: false,
	...overrides,
});

const snapshot = (clips: ParityClip[] = [clip()], duration = 2): ParitySnapshot => ({
	project: { fps: 30, width: 1920, height: 1080 },
	tracks: [{ name: "V1", kind: "video", clips }],
	resources: [{ name: "a.webm", kind: "video", duration }],
	session: { activeInspectorTab: "edit", cursor: 1, isPlaying: false, selectedClip: null },
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
		web.session = { activeInspectorTab: "edit", cursor: 1.6, isPlaying: true, selectedClip: { track: "V1", name: "a.webm", nth: 0 } };
		expect(diffSnapshots(web, snapshot(), 0.02)).toEqual([
			"session.cursor: web 1.6 != desktop 1",
			"session.isPlaying: web true != desktop false",
			'session.selectedClip: web {"track":"V1","name":"a.webm","nth":0} != desktop null',
		]);
	});
});

it.each([
 ["color", { color: "#14b8a6" }],
 ["transform.x", { transform: { x: 2, y: 0, scale: 1, rotation: 0 } }],
 ["transform.y", { transform: { x: 0, y: -3, scale: 1, rotation: 0 } }],
 ["transform.scale", { transform: { x: 0, y: 0, scale: 1.25, rotation: 0 } }],
 ["transform.rotation", { transform: { x: 0, y: 0, scale: 1, rotation: 15 } }],
 ["effects", { effects: [{ name: "Grade", kind: "color-correction", enabled: false, params: {} }] }],
 ["correctionEffectIndices", { correctionEffectIndices: [1, 2] }],
 ["hasColorCorrection", { hasColorCorrection: true }],
] as Array<[string, Partial<ParityClip>]>)("diffs inspector field %s", (field, patch) => {
 expect(diffSnapshots(snapshot([clip(patch)]), snapshot(), 0.02).some(diff => diff.startsWith(`V1[0] a.webm.${field}:`))).toBe(true);
});

it("diffs root tab and compares transform scalars with the declared tolerance", () => {
 const changed = snapshot(); changed.session.activeInspectorTab = "color";
 expect(diffSnapshots(changed, snapshot(), 0.02)).toEqual(['session.activeInspectorTab: web "color" != desktop "edit"']);
 expect(diffSnapshots(snapshot([clip({ transform: { x: 0.0005, y: 0, scale: 1, rotation: 0 } })]), snapshot(), 0.02)).toEqual([]);
});

it("compares nested params structurally while preserving effect and nested array order", () => {
 const effect = { name: "Grade", kind: "color-correction", enabled: false, params: { exposure: { value: 0.25 }, nested: { a: 1, b: [1, 2] } } };
 const left = snapshot([clip({ effects: [effect] })]);
 const right = snapshot([clip({ effects: [{ ...effect, params: { nested: { b: [1, 2], a: 1 }, exposure: { value: 0.25 } } }] })]);
 expect(diffSnapshots(left, right, 0.02)).toEqual([]);
 for (const changed of [
  [{ ...effect, enabled: true }], [{ ...effect, name: "Other" }], [{ ...effect, kind: "blur" }],
  [{ ...effect, params: { ...effect.params, exposure: { value: 0.5 } } }],
  [{ ...effect, params: { ...effect.params, nested: { a: 1, b: [2, 1] } } }],
  [effect, effect],
 ]) expect(diffSnapshots(left, snapshot([clip({ effects: changed })]), 0.02).some(diff => diff.includes(".effects:"))).toBe(true);
 const blur = { ...effect, kind: "blur" };
 expect(diffSnapshots(snapshot([clip({ effects: [effect, blur] })]), snapshot([clip({ effects: [blur, effect] })]), 0.02).some(diff => diff.includes(".effects:"))).toBe(true);
});
