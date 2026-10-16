import { afterEach, expect, test } from "bun:test";
import { renderWithScenario } from "../test/renderApp";
import { Inspector } from "./Inspector";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import { createSkeletonRaceFixture } from "../fixtures/skeletonRace";
type View = Awaited<ReturnType<typeof renderWithScenario>>;
let view: View | null = null;
afterEach(() => { const error = view?.runtime.getSnapshot().runtimeError; view?.destroy(); view = null; expect(error ?? null).toBeNull(); });
const mount = async () => {
 const v = await renderWithScenario("timeline", () => <div style={{ display: "flex", width: 400, height: 600 }}><Inspector /></div>);
 view = v;
 const driver = v.verifier();
 const project = await driver.waitOne(v.rootScope, "activeProject");
 const tracks = await driver.waitMany(project, "tracks", 3);
 const clips = await driver.waitMany(tracks[0], "clips", 2);
 await driver.run("selectEntity", clips[0]._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[0]._nodeId);
 for (const attr of ["name", "opacity", "in", "start", "duration", "fadeIn", "fadeOut", "transform", "$meta$rels$effects$length", "$meta$rels$effects$exists"]) await v.untilAttr(clips[0], attr, x => x !== undefined);
 v.settle();
 const key = (id: string, keys: string) => v.renderer.nativeSimulateKeystrokes(v.renderer.findByTestId(id)!.id, keys);
 const replace = (id: string, text: string) => {
  const old = String(v.renderer.findByTestId(id)!.customProps?.value ?? "");
  key(id, "backspace ".repeat(old.length));
  if (text) key(id, text.split("").join(" "));
 };
 return { v, driver, project, tracks, clips, key, replace };
};
const valueText = (renderer: View["renderer"], testId: string) => {
 const wrapper = renderer.findByTestId(testId)!;
 return renderer.findByType("text").find(node => node.parentId === wrapper.id)?.text ?? wrapper.text;
};
const scalar = (value: unknown) => (value as { value?: number } | null)?.value;

test("opacity keyboard bounds and external model updates echo visibly", async () => {
 const { v, clips, driver, key } = await mount();
 for (const [keys, number] of [["left", 0.9], ["home", 0], ["end", 1]] as const) {
  key("inspector-opacity", keys);
  await v.untilAttr(clips[0], "opacity", x => scalar(x) === number);
  v.settle();
  expect(v.texts()).toContain(`Opacity ${Math.round(number * 100)}%`);
 }
 await driver.run("updateOpacity", { opacityPercent: 40 }, clips[0]);
 await v.untilAttr(clips[0], "opacity", x => scalar(x) === 0.4);
 v.settle();
 expect(v.renderer.findByTestId("inspector-opacity")!.customProps?.["aria-valuetext"]).toBe("Opacity 40%");
});

test("fade buttons use model clamps and disable subtraction at zero", async () => {
 const { v, clips, driver, key } = await mount();
 for (const edge of ["in", "out"] as const) {
  const attr = edge === "in" ? "fadeIn" : "fadeOut";
  expect(v.renderer.findByTestId(`inspector-fade-${edge}-dec`)!.customProps?.tabIndex).toBe(-1);
  key(`inspector-fade-${edge}-inc`, "enter");
  await v.untilAttr(clips[0], attr, x => x === 0.5);
  v.settle();
  expect(v.texts()).toContain("0.5s");
  key(`inspector-fade-${edge}-dec`, "enter");
  await v.untilAttr(clips[0], attr, x => x === 0);
  v.settle();
  expect(v.renderer.findByTestId(`inspector-fade-${edge}-dec`)!.customProps?.tabIndex).toBe(-1);
 }
 await driver.run("setFade", { edge: "in", delta: 3.8 }, clips[0]);
 await v.untilAttr(clips[0], "fadeIn", x => x === 3.8);
 v.settle();
 key("inspector-fade-in-inc", "enter");
 await v.untilAttr(clips[0], "fadeIn", x => x === 4);
 v.settle();
 expect(v.texts()).toContain("4.0s");
});

test("trim start preserves end and source in, no-ops at in zero, and honors duration bounds", async () => {
 const { v, clips, driver, key } = await mount();
 expect(v.renderer.findByTestId("inspector-trim-start-dec")!.customProps?.tabIndex).toBe(-1);
 key("inspector-trim-start-inc", "enter");
 await v.untilAttr(clips[0], "start", x => x === 0.5);
 await v.untilAttr(clips[0], "in", x => x === 0.5);
 await v.untilAttr(clips[0], "duration", x => x === 3.5);
 v.settle();
 expect(v.texts()).toContain("In 0.5s");
 key("inspector-trim-start-dec", "enter");
 await v.untilAttr(clips[0], "in", x => x === 0);
 await driver.run("setTimelineAttrs", { start: 2, in: 0, duration: 1 }, clips[0]);
 await v.untilAttr(clips[0], "start", x => x === 2);
 await v.untilAttr(clips[0], "duration", x => x === 1);
 v.settle();
 key("inspector-trim-start-dec", "enter");
 await driver.run("setActiveInspectorTab", "edit");
 expect(await v.untilAttr(clips[0], "start", x => x === 2)).toBe(2);
 expect(await v.untilAttr(clips[0], "in", x => x === 0)).toBe(0);
 key("inspector-trim-end-dec", "enter");
 await v.untilAttr(clips[0], "duration", x => x === 0.5);
 v.settle();
 expect(v.renderer.findByTestId("inspector-trim-end-dec")!.customProps?.tabIndex).toBe(-1);
 key("inspector-trim-end-inc", "enter");
 await v.untilAttr(clips[0], "duration", x => x === 1);
 await driver.run("setTimelineAttrs", { start: 2, in: 0, duration: 120 }, clips[0]);
 await v.untilAttr(clips[0], "duration", x => x === 120);
 v.settle();
 key("inspector-trim-end-inc", "enter");
 await driver.run("setActiveInspectorTab", "edit");
 expect(await v.untilAttr(clips[0], "duration", x => x === 120)).toBe(120);
});

test("each transform writes one scalar including negative and zero, preserving siblings", async () => {
 const { v, clips, driver, replace, key } = await mount();
 for (const [field, number] of [["x", -2], ["y", 3], ["scale", 0], ["rotation", -90], ["scale", -1]] as const) {
  const id = `inspector-transform-${field}`;
  replace(id, String(number));
  const transform = await v.untilAttr(clips[0], "transform", x => (x as Record<string, { value: number }>)[field].value === number) as Record<string, { value: number }>;
  v.settle();
  expect(v.renderer.findByTestId(id)!.customProps?.value).toBe(String(number));
  key(id, "enter");
  expect(transform[field].value).toBe(number);
 }
 const before = await v.untilAttr(clips[0], "transform", () => true) as Record<string, { value: number }>;
 expect(before.x.value).toBe(-2); expect(before.y.value).toBe(3); expect(before.rotation.value).toBe(-90); expect(before.scale.value).toBe(-1);
 replace("inspector-transform-x", "-");
 key("inspector-transform-x", "enter");
 await driver.run("setActiveInspectorTab", "edit");
 expect((await v.untilAttr(clips[0], "transform", () => true) as typeof before).x.value).toBe(-2);
 expect(v.renderer.findByTestId("inspector-transform-x")!.customProps?.value).toBe("-2");
 await driver.run("setTransform", { y: 7 }, clips[0]);
 await v.untilAttr(clips[0], "transform", x => (x as typeof before).y.value === 7);
 v.settle();
 expect(v.renderer.findByTestId("inspector-transform-y")!.customProps?.value).toBe("7");
});

test("effects use generated metadata and real identities for repeated add and remove", async () => {
 const { v, clips, key } = await mount();
 expect(v.findAll("inspector-effects-manage")).toHaveLength(0);
 const ids: string[] = [];
 for (const [index, kind] of ["blur", "sharpen", "tint", "blur"].entries()) {
  key(`inspector-effect-add-${kind}`, "enter");
  await v.untilAttr(clips[0], "$meta$rels$effects$length", x => x === index + 1);
  const effects = await v.untilMany(clips[0], "effects", n => n === index + 1);
  const added = effects[index];
  await v.untilAttr(added, "kind", x => x === kind);
  ids.push(added._nodeId);
  v.settle();
  expect(v.texts()).toContain(`${index + 1} effects`);
 }
 expect(new Set(ids).size).toBe(4);
 key("inspector-effects-manage", "enter");
 for (const effect of await v.untilMany(clips[0], "effects", n => n === 4)) await v.untilAttr(effect, "name", x => typeof x === "string");
 v.settle();
 expect(v.findAll("inspector-effect-row")).toHaveLength(4);
 key(`inspector-effect-remove-${ids[1]}`, "enter");
 const remaining = await v.untilMany(clips[0], "effects", n => n === 3);
 expect(remaining.map(s => s._nodeId)).toEqual([ids[0], ids[2], ids[3]]);
 for (const [index, id] of [ids[0], ids[2], ids[3]].entries()) {
  v.settle(); key(`inspector-effect-remove-${id}`, "enter");
  await v.untilAttr(clips[0], "$meta$rels$effects$length", x => x === 2 - index);
  await v.untilMany(clips[0], "effects", n => n === 2 - index);
 }
 await v.untilAttr(clips[0], "$meta$rels$effects$exists", x => x === false);
 v.settle();
 expect(v.findAll("inspector-effects-manage")).toHaveLength(0);
 expect(v.findAll("inspector-effects-menu")).toHaveLength(0);
 expect(v.texts()).toContain("0 effects");
});

test("bounded panel scroll reaches the effects buttons through real native hit testing", async () => {
 const { v, clips } = await mount();
 const panel = v.renderer.findByTestId("inspector-panel-edit")!;
 const body = v.renderer.findByTestId("inspector-edit-controls")!;
 const bounds = v.renderer.getElementBounds(panel.id)!;
 expect(bounds.height).toBeGreaterThan(0); expect(bounds.height).toBeLessThan(600);
 expect(panel.style.overflowY).toBe("scroll"); expect(body.style.flexShrink).toBe(0);
 v.renderer.scrollTo(panel.id, 0, -1000);
 v.settle();
 const button = v.renderer.findByTestId("inspector-effect-add-tint")!;
 const b = v.renderer.getElementBounds(button.id)!;
 expect(b.y).toBeGreaterThanOrEqual(bounds.y);
 expect(b.y + b.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
 v.renderer.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2);
 await v.untilAttr(clips[0], "$meta$rels$effects$length", x => x === 1);
 const [effect] = await v.untilMany(clips[0], "effects", n => n === 1);
 expect(await v.untilAttr(effect, "kind", x => x === "tint")).toBe("tint");
});

test("selection and tab replacement discard transform drafts and effects menu state", async () => {
 const { v, clips, driver, key, replace } = await mount();
 key("inspector-effect-add-blur", "enter");
 await v.untilAttr(clips[0], "$meta$rels$effects$length", x => x === 1);
 v.settle(); key("inspector-effects-manage", "enter");
 replace("inspector-transform-x", "-");
 await driver.run("selectEntity", clips[1]._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[1]._nodeId);
 await v.untilAttr(clips[1], "transform", x => x !== undefined);
 v.settle();
 expect(v.findAll("inspector-effects-menu")).toHaveLength(0);
 expect(v.renderer.findByTestId("inspector-transform-x")!.customProps?.value).toBe("0");
 expect((await v.untilAttr(clips[0], "transform", () => true) as Record<string, { value: number }>).x.value).toBe(0);
 replace("inspector-transform-x", "-");
 await driver.run("setActiveInspectorTab", "audio");
 await v.untilAttr(v.rootScope, "activeInspectorTab", x => x === "audio"); v.settle();
 expect(v.findAll("inspector-edit-controls")).toHaveLength(0);
 await driver.run("setActiveInspectorTab", "edit");
 await v.untilAttr(v.rootScope, "activeInspectorTab", x => x === "edit"); v.settle();
 expect(v.renderer.findByTestId("inspector-transform-x")!.customProps?.value).toBe("0");
});

test("native trim beyond source preserves timing and records a local CRDT conflict", async () => {
 const { v, driver, project, tracks, key } = await mount();
 const resources = await driver.waitMany(project, "resources", 2);
 const resourceInfo = await Promise.all(resources.map(async scope => ({ scope, name: await driver.waitAttr(scope, "name"), kind: await driver.waitAttr(scope, "kind") })));
 const source = resourceInfo.find(item => item.name === "Interview.mp4" && item.kind === "video")!.scope;
 expect(await driver.waitAttr(source, "duration")).toBe(42);
 await driver.run("addResourceToTimeline", source._nodeId, project);
 const clips = await driver.waitMany(tracks[0], "clips", 5);
 const clipInfo = await Promise.all(clips.map(async scope => ({ scope, name: await driver.waitAttr(scope, "name") })));
 const clip = clipInfo.find(item => item.name === "Interview.mp4")!.scope;
 const linkedResource = await driver.waitOne(clip, "resource");
 expect(linkedResource._nodeId).toBe(source._nodeId);
 expect(await driver.waitAttr(linkedResource, "duration")).toBe(42);
 await driver.run("selectEntity", clip._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clip._nodeId);
 await v.untilAttr(clip, "name", x => x === "Interview.mp4");
 await v.untilAttr(clip, "duration", x => x === 42);
 const start = await v.untilAttr(clip, "start", x => typeof x === "number");
 await v.untilAttr(clip, "in", x => x === 0);
 const conflictAttr = "$meta$aggregates$crdt$clipTiming$open_conflicts_count";
 expect(await v.untilAttr(clip, conflictAttr, x => x === 0)).toBe(0);
 v.settle();
 expect(v.renderer.findByTestId("inspector-trim-end-inc")!.customProps?.tabIndex).toBe(0);
 expect(valueText(v.renderer, "inspector-trim-end-value")).toBe("42.0s");
 key("inspector-trim-end-inc", "enter");
 expect(await v.untilAttr(clip, conflictAttr, x => x === 1)).toBe(1);
 expect(await v.untilAttr(clip, "start", x => x === start)).toBe(start);
 expect(await v.untilAttr(clip, "in", x => x === 0)).toBe(0);
 expect(await v.untilAttr(clip, "duration", x => x === 42)).toBe(42);
 v.settle();
 expect(valueText(v.renderer, "inspector-trim-end-value")).toBe("42.0s");
 expect(v.runtime.getSnapshot().runtimeError).toBeNull();
});
test("receiver timing display stays unavailable until each declared finite value arrives", () => {
 const current = createSkeletonRaceFixture([]);
 const root = createTestRoot();
 try {
  root.render(() => <div style={{ display: "flex", width: 400, height: 600 }}><RootScope runtime={current.runtime}><Inspector /></RootScope></div>);
  root.flushSync(() => { current.deliverSelectedClipRel("clip"); current.deliverAttrs("clip", { name: "Timing" }); });
  expect(root.renderer.getAllText()).toContain("In Unavailable");
  expect(valueText(root.renderer, "inspector-trim-start-value")).toBe("Unavailable");
  expect(valueText(root.renderer, "inspector-trim-end-value")).toBe("Unavailable");
  expect(root.renderer.findByTestId("inspector-trim-start-inc")!.customProps?.tabIndex).toBe(-1);
  root.flushSync(() => current.deliverAttrs("clip", { start: 0, duration: 4 }));
  expect(root.renderer.getAllText()).toContain("In Unavailable");
  expect(valueText(root.renderer, "inspector-trim-start-value")).toBe("0.0s");
  expect(valueText(root.renderer, "inspector-trim-end-value")).toBe("4.0s");
  expect(root.renderer.findByTestId("inspector-trim-end-inc")!.customProps?.tabIndex).toBe(-1);
 } finally { root.unmount(); current.destroy(); }
});
