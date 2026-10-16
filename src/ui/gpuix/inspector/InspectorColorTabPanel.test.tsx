import { afterEach, expect, test } from "bun:test";
import { renderWithScenario } from "../test/renderApp";
import { Inspector } from "./Inspector";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import { createSkeletonRaceFixture } from "../fixtures/skeletonRace";
import { waitForManyScopes } from "../fixtures/scopeWait";
import { colorGradePresets } from "../../../video-editor/components/inspector/types";
import { AppShell } from "../AppShell";
import { useReviewMode } from "../review/reviewModeState";
import { createConflictPeers, createSharedProject, joinSharedProject, renderOnPeer, untilPeerAttr, untilPeerMany } from "../test/conflictPeers";
type View = Awaited<ReturnType<typeof renderWithScenario>>;
let view: View | null = null;
afterEach(() => { const error = view?.runtime.getSnapshot().runtimeError; view?.destroy(); view = null; expect(error ?? null).toBeNull(); });
const mount = async (withReview = false) => {
 let review: ReturnType<typeof useReviewMode> | null = null;
 const ReviewFixture = () => { review = useReviewMode(); return <Inspector />; };
 const v = await renderWithScenario("timeline", () => withReview ? <AppShell inspector={<ReviewFixture />} /> : <div style={{ display: "flex", width: 400, height: 600 }}><Inspector /></div>);
 view = v;
 const driver = v.verifier();
 const project = await driver.waitOne(v.rootScope, "activeProject");
 const tracks = await driver.waitMany(project, "tracks", 3);
 const clips = await driver.waitMany(tracks[0], "clips", 4);
 await driver.run("selectEntity", clips[0]._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[0]._nodeId);
 await driver.run("setActiveInspectorTab", "color");
 await v.untilAttr(v.rootScope, "activeInspectorTab", x => x === "color");
 await v.untilAttr(clips[0], "name", x => x === "Intro");
 await driver.run("addEffect", { kind: "color-correction", name: "Held" }, clips[0]);
 const [held] = await v.untilMany(clips[0], "colorCorrectionEffects", n => n === 1);
 await v.untilAttr(held, "enabled", x => x === true);
 v.settle();
 return { v, driver, clips, tracks, held, review: () => review! };
};
const hold = (v: View, id: string) => {
 const element = v.renderer.findByTestId(`inspector-before-${id}`)!;
 const panel = v.renderer.findByTestId("inspector-panel-color")!;
 v.renderer.scrollTo(panel.id, 0, 0); v.settle();
 const initial = v.renderer.getElementBounds(element.id)!;
 const panelBounds = v.renderer.getElementBounds(panel.id)!;
 v.renderer.scrollTo(panel.id, 0, -Math.max(0, initial.y - panelBounds.y - 20)); v.settle();
 const b = v.renderer.getElementBounds(element.id)!;
 const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
 v.renderer.nativeSimulateMouseDown(point.x, point.y);
 return point;
};

test("Before hold then removeEffect cleanup preserves absence and sibling state", async () => {
 const { v, driver, clips, held } = await mount();
 await driver.run("addEffect", { kind: "color-correction", name: "Sibling", enabled: false }, clips[0]);
 const effects = await v.untilMany(clips[0], "colorCorrectionEffects", n => n === 2);
 const sibling = effects[1];
 await v.untilAttr(sibling, "enabled", x => x === false);
 v.settle();
 const point = hold(v, held._nodeId);
 await v.untilAttr(held, "enabled", x => x === false);
 v.settle();
 expect(v.texts()).toContain("Before held");
 await driver.run("removeEffect", { effectId: held._nodeId }, clips[0]);
 const projection = await v.untilMany(clips[0], "colorCorrectionEffects", n => n === 1);
 expect(projection.map(s => s._nodeId)).toEqual([sibling._nodeId]);
 const raw = await v.untilMany(clips[0], "effects", n => n === 1);
 expect(raw.map(s => s._nodeId)).toEqual([sibling._nodeId]);
 v.settle();
 await driver.run("setActiveInspectorTab", "color");
 expect(v.runtime.getSnapshot().runtimeError).toBeNull();
 expect(v.renderer.findByTestId(`inspector-before-${held._nodeId}`)).toBeUndefined();
 v.renderer.nativeSimulateMouseUp(point.x, point.y);
 await driver.run("setActiveInspectorTab", "color");
 expect(await v.untilAttr(sibling, "enabled", x => x === false)).toBe(false);
 expect((await v.untilMany(clips[0], "effects", n => n === 1)).map(s => s._nodeId)).toEqual([sibling._nodeId]);
});

test("Before hold then deleteSelectedClip cleanup preserves public ownership absence", async () => {
 const { v, driver, clips, tracks, held } = await mount();
 await driver.run("addEffect", { kind: "color-correction", name: "Other clip grade", enabled: false }, clips[1]);
 const [other] = await v.untilMany(clips[1], "colorCorrectionEffects", n => n === 1);
 await v.untilAttr(other, "enabled", x => x === false);
 const point = hold(v, held._nodeId);
 await v.untilAttr(held, "enabled", x => x === false);
 v.settle();
 await driver.run("deleteSelectedClip");
 await v.untilOne(v.rootScope, "selectedClip", scope => scope === null);
 const remaining = await v.untilMany(tracks[0], "clips", n => n === 3);
 expect(remaining.map(scope => scope._nodeId)).not.toContain(clips[0]._nodeId);
 v.settle();
 await driver.run("setActiveInspectorTab", "color");
 expect(v.runtime.getSnapshot().runtimeError).toBeNull();
 expect(v.renderer.findByTestId(`inspector-before-${held._nodeId}`)).toBeUndefined();
 await driver.run("selectEntity", clips[1]._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", scope => scope?._nodeId === clips[1]._nodeId);
 await v.untilAttr(clips[1], "name", x => typeof x === "string");
 v.settle();
 v.renderer.nativeSimulateMouseUp(point.x, point.y);
 await driver.run("setActiveInspectorTab", "color");
 expect(await v.untilAttr(other, "enabled", x => x === false)).toBe(false);
 expect((await v.untilMany(clips[1], "colorCorrectionEffects", n => n === 1)).map(s => s._nodeId)).toEqual([other._nodeId]);
 expect((await v.untilMany(tracks[0], "clips", n => n === 3)).map(scope => scope._nodeId)).not.toContain(clips[0]._nodeId);
});

const key = (v: View, id: string, keys: string) => v.renderer.nativeSimulateKeystrokes(v.renderer.findByTestId(id)!.id, keys);
const scalarParam = (params: unknown, field: string) => (params as Record<string, { value?: number }> | null)?.[field]?.value;

test("label HEX and every swatch write Clip color and echo in header", async () => {
 const { v, clips } = await mount();
 const input = () => v.renderer.findByTestId("inspector-label-color")!;
 key(v, "inspector-label-color", "backspace ".repeat(7));
 key(v, "inspector-label-color", "# a b c d e f");
 await v.untilAttr(clips[0], "color", x => x === "#abcdef"); v.settle();
 expect(input().customProps?.value).toBe("#abcdef");
 expect(v.renderer.findByTestId("inspector-thumbnail")!.style.borderColor).toBe("#abcdef");
 for (const hex of ["2563eb", "16a34a", "dc2626", "ca8a04", "7c3aed", "0891b2"]) {
  key(v, `inspector-label-color-${hex}`, "enter");
  await v.untilAttr(clips[0], "color", x => x === `#${hex}`); v.settle();
  expect(input().customProps?.value).toBe(`#${hex}`);
  expect(v.renderer.findByTestId("inspector-thumbnail")!.style.borderColor).toBe(`#${hex}`);
 }
});

test("all projected corrections preserve identity amid raw effects, reorder, bypass and removal", async () => {
 const { v, driver, clips, held } = await mount();
 await driver.run("addEffect", { kind: "blur" }, clips[0]);
 await driver.run("addEffect", { kind: "color-correction", enabled: false, name: "Second" }, clips[0]);
 await driver.run("addEffect", { kind: "tint" }, clips[0]);
 const raw = await v.untilMany(clips[0], "effects", n => n === 4);
 const corrections = await v.untilMany(clips[0], "colorCorrectionEffects", n => n === 2);
 const second = corrections[1];
 await v.untilAttr(second, "enabled", x => x === false); v.settle();
 expect(v.renderer.findByTestId(`inspector-correction-${held._nodeId}`)).toBeDefined();
 expect(v.renderer.findByTestId(`inspector-correction-${second._nodeId}`)).toBeDefined();
 expect(v.renderer.findByTestId(`inspector-correction-${raw[1]._nodeId}`)).toBeUndefined();
 expect(v.renderer.findByTestId("inspector-correction-add")).toBeUndefined();
 await driver.run("reorderEffect", { effectId: second._nodeId, toIndex: 0 }, clips[0]);
 const reordered = await waitForManyScopes(v.runtime, clips[0], "colorCorrectionEffects", scopes => scopes[0]?._nodeId === second._nodeId && scopes[1]?._nodeId === held._nodeId);
 // Separate public order read after the action settles.
 expect(reordered.map(s => s._nodeId)).toEqual([second._nodeId, held._nodeId]);
 v.settle();
 expect(v.renderer.findByTestId(`inspector-grade-exposure-${second._nodeId}`)!.customProps?.tabIndex).toBe(0);
 await driver.run("removeEffect", { effectId: held._nodeId }, clips[0]);
 await v.untilMany(clips[0], "colorCorrectionEffects", n => n === 1);
 await driver.run("removeEffect", { effectId: second._nodeId }, clips[0]);
 await v.untilMany(clips[0], "colorCorrectionEffects", n => n === 0);
 await v.untilAttr(clips[0], "$meta$rels$colorCorrectionEffects$exists", x => x === false); v.settle();
 key(v, "inspector-correction-add", "enter");
 const [added] = await v.untilMany(clips[0], "colorCorrectionEffects", n => n === 1);
 await v.untilAttr(added, "enabled", x => x === true);
 await v.untilAttr(added, "name", x => x === "Color correction"); v.settle();
 expect(added._nodeId).not.toBe(held._nodeId);
 expect(v.renderer.findByTestId("inspector-correction-add")).toBeUndefined();
 expect((await v.untilMany(clips[0], "effects", n => n === 3)).map(s => s._nodeId)).toContain(raw[1]._nodeId);
});

test("four scalar deltas replace keyframes, preserve unknown params and keep bypassed grade disabled", async () => {
 const { v, driver, held } = await mount();
 await driver.run("setEffectParams", { params: { unknown: { retained: true }, exposure: { value: 0, keyframes: [{ time: 0, value: 0.4 }] } } }, held);
 await v.untilAttr(held, "params", x => !!(x as Record<string, unknown>)?.unknown);
 await driver.run("setEffectEnabled", { enabled: false }, held);
 await v.untilAttr(held, "enabled", x => x === false); v.settle();
 for (const [field, value] of [["exposure", 0.01], ["contrast", 1.01], ["saturation", 1.01], ["temperature", 0.01]] as const) {
  key(v, `inspector-grade-${field}-${held._nodeId}`, "right");
  const params = await v.untilAttr(held, "params", x => scalarParam(x, field) === value) as Record<string, unknown>;
  v.settle();
  expect(params.unknown).toEqual({ retained: true }); expect(params[field]).toEqual({ value }); expect(params.lookId).toBe("custom");
  expect(await v.untilAttr(held, "enabled", x => x === false)).toBe(false);
 }
 await driver.run("patchEffectParams", { params: { contrast: { value: 0.67 } } }, held);
 await v.untilAttr(held, "params", x => scalarParam(x, "contrast") === 0.67); v.settle();
 expect(v.renderer.findByTestId(`inspector-grade-contrast-${held._nodeId}`)!.customProps?.["aria-valuetext"]).toBe("Contrast 67%");
 key(v, `inspector-grade-bypass-${held._nodeId}`, "enter");
 await v.untilAttr(held, "enabled", x => x === true); v.settle(); expect(v.texts()).toContain("Enabled");
});

test("reset and each shared basic preset patch canonical params without enabling or losing unknown keys", async () => {
 const { v, driver, held } = await mount();
 await driver.run("setEffectParams", { params: { unknown: "retained", exposure: { value: 0.7 }, hue: { value: 0.3 }, gamma: { value: 0.5 } } }, held);
 await v.untilAttr(held, "params", x => scalarParam(x, "exposure") === 0.7);
 await driver.run("setEffectEnabled", { enabled: false }, held);
 await v.untilAttr(held, "enabled", x => x === false); v.settle();
 key(v, `inspector-grade-reset-${held._nodeId}`, "enter");
 const reset = await v.untilAttr(held, "params", x => (x as Record<string, unknown>)?.lookId === "clean") as Record<string, unknown>;
 expect(reset).toEqual({ unknown: "retained", lookId: "clean", lookIntensity: { value: 1 }, exposure: { value: 0 }, contrast: { value: 1 }, saturation: { value: 1 }, gamma: { value: 1 }, temperature: { value: 0 }, hue: { value: 0 } });
 for (const preset of colorGradePresets) {
  v.settle(); key(v, `inspector-grade-preset-${preset.id}-${held._nodeId}`, "enter");
  const params = await v.untilAttr(held, "params", x => Object.entries(preset.params).every(([field, value]) => scalarParam(x, field) === value) && (x as Record<string, unknown>)?.lookId === "custom") as Record<string, unknown>;
  expect(params.unknown).toBe("retained"); expect(params.lookIntensity).toEqual({ value: 1 });
  expect(await v.untilAttr(held, "enabled", x => x === false)).toBe(false);
  v.settle(); expect(v.texts()).toContain("Bypassed");
 }
});

test("Before mouse release, leave and real blur restore canonical enabled", async () => {
 const { v, held, driver } = await mount();
 for (const finish of ["up", "leave", "blur"]) {
  const point = hold(v, held._nodeId);
  await v.untilAttr(held, "enabled", x => x === false); v.settle(); expect(v.texts()).toContain("Before held");
  if (finish === "up") v.renderer.nativeSimulateMouseUp(point.x, point.y);
  if (finish === "leave") v.renderer.nativeSimulateMouseMove(1200, 750, 0);
  if (finish === "blur") v.renderer.focusElement(v.renderer.findByTestId("inspector-tabs-color")!.id);
  await v.untilAttr(held, "enabled", x => x === true); v.settle(); expect(v.texts()).toContain("Press and hold: Before");
  v.renderer.nativeSimulateMouseUp(point.x, point.y);
 }
 const b = v.renderer.getElementBounds(v.renderer.findByTestId(`inspector-before-${held._nodeId}`)!.id)!;
 v.renderer.nativeSimulateMouseDown(b.x + b.width / 2, b.y + b.height / 2, 1);
 v.renderer.nativeSimulateMouseUp(b.x + b.width / 2, b.y + b.height / 2, 1);
 await driver.run("setActiveInspectorTab", "color");
 expect(await v.untilAttr(held, "enabled", x => x === true)).toBe(true);
});

test("Before key repeat is idempotent, bypass cannot start, and last release wins external false", async () => {
 const { v, driver, held } = await mount();
 const before = () => v.renderer.findByTestId(`inspector-before-${held._nodeId}`)!;
 for (const keyName of ["enter", "space"]) {
  v.renderer.nativeSimulateKeyDown(before().id, keyName);
  await v.untilAttr(held, "enabled", x => x === false);
  v.renderer.nativeSimulateKeyDown(before().id, keyName, true);
  await driver.run("setEffectEnabled", { enabled: false }, held);
  v.renderer.nativeSimulateKeyUp(before().id, keyName);
  await v.untilAttr(held, "enabled", x => x === true); v.settle(); expect(v.texts()).toContain("Press and hold: Before");
 }
 await driver.run("setEffectEnabled", { enabled: false }, held); await v.untilAttr(held, "enabled", x => x === false); v.settle();
 v.renderer.nativeSimulateKeyDown(before().id, "enter"); v.renderer.nativeSimulateKeyUp(before().id, "enter");
 await driver.run("setActiveInspectorTab", "color");
 expect(await v.untilAttr(held, "enabled", x => x === false)).toBe(false); expect(v.texts()).not.toContain("Before held");
});

test("Before selection, tab, review and unmount restore the captured old owner", async () => {
 const { v, driver, clips, held, review } = await mount(true);
 await driver.run("addEffect", { kind: "color-correction", enabled: false }, clips[1]);
 const [other] = await v.untilMany(clips[1], "colorCorrectionEffects", n => n === 1); await v.untilAttr(other, "enabled", x => x === false);
 for (const finish of ["selection", "tab", "review", "unmount"]) {
  const point = hold(v, held._nodeId); await v.untilAttr(held, "enabled", x => x === false);
  if (finish === "selection") {
   await driver.run("selectEntity", clips[1]._nodeId); await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[1]._nodeId);
  } else if (finish === "tab") {
   await driver.run("setActiveInspectorTab", "edit"); await v.untilAttr(v.rootScope, "activeInspectorTab", x => x === "edit");
  } else if (finish === "review") { review().open(); v.settle(); }
  else v.root.unmount();
  await v.untilAttr(held, "enabled", x => x === true);
  expect(await v.untilAttr(other, "enabled", x => x === false)).toBe(false);
  if (finish === "unmount") break;
  if (finish === "selection") { await driver.run("selectEntity", clips[0]._nodeId); await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[0]._nodeId); }
  if (finish === "tab") { await driver.run("setActiveInspectorTab", "color"); await v.untilAttr(v.rootScope, "activeInspectorTab", x => x === "color"); }
  if (finish === "review") review().close();
  v.settle(); v.renderer.nativeSimulateMouseUp(point.x, point.y); await driver.run("setActiveInspectorTab", "color");
  expect(await v.untilAttr(held, "enabled", x => x === true)).toBe(true);
 }
});

test("receiver correction rel and metadata wait for enabled, including false readiness", () => {
 const current = createSkeletonRaceFixture([]); const root = createTestRoot();
 try {
  root.render(() => <div style={{ display: "flex", width: 400, height: 600 }}><RootScope runtime={current.runtime}><Inspector /></RootScope></div>);
  root.flushSync(() => { current.deliverAttrs("root", { activeInspectorTab: "color" }); current.deliverSelectedClipRel("clip"); current.deliverAttrs("clip", { name: "Late grade" }); });
  expect(root.renderer.findByTestId("inspector-correction-add")).toBeUndefined();
  root.flushSync(() => current.deliverColorCorrectionEffectsRel("clip", ["effect"]));
  expect(root.renderer.findByTestId("inspector-correction-effect")).toBeUndefined();
  root.flushSync(() => current.deliverAttrs("clip", { $meta$rels$colorCorrectionEffects$exists: true }));
  expect(root.renderer.findByTestId("inspector-correction-add")).toBeUndefined();
  root.flushSync(() => current.deliverAttrs("effect", { enabled: false }));
  expect(root.renderer.findByTestId("inspector-correction-effect")).toBeDefined(); expect(root.renderer.getAllText()).toContain("Bypassed");
  root.flushSync(() => { current.deliverColorCorrectionEffectsRel("clip", []); current.deliverAttrs("clip", { $meta$rels$colorCorrectionEffects$exists: false }); });
  expect(root.renderer.findByTestId("inspector-correction-add")).toBeDefined(); expect(root.renderer.findByTestId("inspector-correction-effect")).toBeUndefined();
  expect(current.runtime.getSnapshot().runtimeError).toBeNull();
 } finally { root.unmount(); current.destroy(); }
});

test("remote-created Clip mounts on peer B without prior Color and follows external projection changes", async () => {
 const peers = await createConflictPeers("gpuix-color-remote"); let mounted: ReturnType<typeof renderOnPeer> | null = null;
 try {
  const shared = await createSharedProject(peers); const joined = await joinSharedProject(peers, shared.project._nodeId);
  await peers.a.driver.run("addClip", { name: "Remote color", mediaKind: "video", start: 0, in: 0, duration: 4 }, shared.tracks[0]);
  const [clipA] = await peers.a.driver.waitMany(shared.tracks[0], "clips", 1);
  await peers.a.driver.run("addEffect", { kind: "blur" }, clipA);
  await peers.a.driver.run("addEffect", { kind: "color-correction", enabled: false }, clipA);
  const [gradeA] = await untilPeerMany(peers.a, clipA, "colorCorrectionEffects", n => n === 1);
  const [clipB] = await peers.b.driver.waitMany(joined.tracks[0], "clips", 1);
  await untilPeerAttr(peers.b, clipB, "name", x => x === "Remote color");
  await peers.b.driver.run("selectEntity", clipB._nodeId); await peers.b.driver.run("setActiveInspectorTab", "color");
  mounted = renderOnPeer(peers.b, () => <div style={{ display: "flex", width: 400, height: 600 }}><Inspector /></div>);
  const [gradeB] = await untilPeerMany(peers.b, clipB, "colorCorrectionEffects", n => n === 1);
  await untilPeerAttr(peers.b, gradeB, "enabled", x => x === false); await untilPeerAttr(peers.b, clipB, "$meta$rels$colorCorrectionEffects$exists", x => x === true); mounted.settle();
  expect(gradeB._nodeId).toBe(gradeA._nodeId); expect(mounted.has(`inspector-correction-${gradeB._nodeId}`)).toBe(true); expect(mounted.has("inspector-correction-add")).toBe(false);
  await peers.a.driver.run("patchEffectParams", { params: { exposure: { value: 0.37 } } }, gradeA);
  await untilPeerAttr(peers.b, gradeB, "params", x => scalarParam(x, "exposure") === 0.37); mounted.settle();
  expect(mounted.root.renderer.findByTestId(`inspector-grade-exposure-${gradeB._nodeId}`)!.customProps?.["aria-valuetext"]).toBe("Exposure 37%");
  await peers.a.driver.run("removeEffect", { effectId: gradeA._nodeId }, clipA);
  await untilPeerMany(peers.b, clipB, "colorCorrectionEffects", n => n === 0); await untilPeerAttr(peers.b, clipB, "$meta$rels$colorCorrectionEffects$exists", x => x === false); mounted.settle(); expect(mounted.has("inspector-correction-add")).toBe(true);
  expect(peers.a.runtime.getSnapshot().runtimeError).toBeNull(); expect(peers.b.runtime.getSnapshot().runtimeError).toBeNull();
 } finally { mounted?.destroy(); peers.destroy(); }
});

test("external grade echo preserves an invalid label draft without focus or color writes", async () => {
 const { v, driver, clips, held } = await mount();
 await v.untilAttr(clips[0], "color", x => x === "#2563eb"); v.settle();
 const input = () => v.renderer.findByTestId("inspector-label-color")!;
 key(v, "inspector-label-color", "backspace ".repeat(7)); key(v, "inspector-label-color", "# a b");
 expect(input().customProps?.value).toBe("#ab");
 const focused = v.renderer.getFocusedElementId();
 await driver.run("patchEffectParams", { params: { exposure: { value: 0.26 } } }, held);
 await v.untilAttr(held, "params", x => scalarParam(x, "exposure") === 0.26); v.settle();
 expect(input().customProps?.value).toBe("#ab"); expect(v.renderer.getFocusedElementId()).toBe(focused);
 expect(await v.untilAttr(clips[0], "color", x => x === "#2563eb")).toBe("#2563eb");
 v.renderer.focusElement(v.renderer.findByTestId("inspector-tabs-color")!.id);
 await driver.run("setActiveInspectorTab", "color"); v.settle();
 expect(input().customProps?.value).toBe("#2563eb");
 expect(await v.untilAttr(clips[0], "color", x => x === "#2563eb")).toBe("#2563eb");
});
