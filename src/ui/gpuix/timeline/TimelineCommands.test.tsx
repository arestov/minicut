import { afterEach, describe, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { RootScope } from "../../../dkt-solid-sync";
import { createSkeletonRaceFixture } from "../fixtures/skeletonRace";
import { Inspector } from "../inspector/Inspector";
import { renderWithScenario } from "../test/renderApp";
import { Timeline } from "./Timeline";
import { TimelineCommands } from "./TimelineCommands";

type View = Awaited<ReturnType<typeof renderWithScenario>>;
let view: View | null = null;
afterEach(() => {
 const error = view?.runtime.getSnapshot().runtimeError;
 view?.destroy(); view = null;
 expect(error ?? null).toBeNull();
});
const ids = ["timeline-split", "timeline-nudge-back", "timeline-nudge-forward", "timeline-delete"];
const mount = async () => {
 const v = await renderWithScenario("timeline", () => <div style={{ display: "flex", flexDirection: "row", width: 1280, height: 800 }}><div style={{ display: "flex", flexDirection: "column", width: 940, height: 400 }}><Timeline viewportWidth={() => 800} /></div><Inspector /></div>);
 view = v;
 const driver = v.verifier();
 const project = await driver.waitOne(v.rootScope, "activeProject");
 const tracks = await driver.waitMany(project, "tracks", 3);
 const clips = await driver.waitMany(tracks[0], "clips", 4);
 await v.untilAttr(v.rootScope, "$meta$rels$activeProject$exists", x => x === true);
 await v.untilAttr(v.rootScope, "timelineZoom", x => x === 56);
 await v.untilAttr(project, "title", x => typeof x === "string");
 for (const track of tracks) {
  await v.untilAttr(track, "kind", x => typeof x === "string");
  const children = await driver.waitMany(track, "clips", 2);
  for (const clip of children) for (const attr of ["name", "start", "duration"]) await v.untilAttr(clip, attr, x => x !== undefined);
 }
 v.settle();
 const select = async (clip: typeof clips[number]) => {
  await driver.run("selectEntity", clip._nodeId);
  await v.untilOne(v.rootScope, "selectedClip", x => x?._nodeId === clip._nodeId);
  await v.untilAttr(v.rootScope, "selectedEntityId", x => x === clip._nodeId);
  await v.untilAttr(v.rootScope, "$meta$rels$selectedClip$exists", x => x === true);
  await v.untilAttr(clip, "name", x => typeof x === "string");
  await v.untilAttr(clip, "in", x => typeof x === "number");
  v.settle();
 };
 const read = (clip: typeof clips[number]) => v.runtime.readAttrs(clip, ["start", "duration", "in", "name"]);
 return { v, driver, project, tracks, clips, select, read };
};

describe("TimelineCommands", () => {
 test("no selection disables every clip command", async () => {
  const { v, tracks } = await mount();
  await v.untilAttr(v.rootScope, "$meta$rels$selectedClip$exists", x => x === false);
  v.settle();
  expect(v.texts()).toContain("No clip selected");
  for (const id of ids) {
   expect(v.renderer.findByTestId(id)!.customProps?.tabIndex).toBe(-1);
   v.click(id);
  }
  expect(v.runtime.readMany(tracks[0], "clips")).toHaveLength(4);
  expect(v.runtime.readOne(v.rootScope, "selectedClip")).toBeNull();
 });

 test("native nudge buttons use canonical start, clamp, preserve siblings and echo in Inspector", async () => {
  const { v, clips, select, read } = await mount();
  await select(clips[0]);
  const sibling = read(clips[1]);
  for (const [id, start] of [["timeline-nudge-forward", 0.5], ["timeline-nudge-back", 0], ["timeline-nudge-back", 0]] as const) {
   v.click(id);
   await v.untilAttr(clips[0], "start", x => x === start);
   v.settle();
   expect(v.texts()).toContain(`Clip 1 - V1 - ${start.toFixed(1)}s - Duration 4.0s`);
   expect(read(clips[1])).toEqual(sibling);
  }
 });

 test("external selection and deletion retarget commands and Delete clears public selection and Inspector", async () => {
  const { v, driver, tracks, clips, select, read } = await mount();
  await select(clips[0]);
  await select(clips[1]);
  expect(v.texts()).toContain("Interview A");
  v.click("timeline-nudge-forward");
  await v.untilAttr(clips[1], "start", x => x === 4.5);
  expect(read(clips[0]).start).toBe(0);
  v.click("timeline-delete");
  await v.untilMany(tracks[0], "clips", n => n === 3);
  await v.untilOne(v.rootScope, "selectedClip", x => x === null);
  await v.untilAttr(v.rootScope, "selectedEntityId", x => x === null);
  v.settle();
  expect(v.runtime.readMany(tracks[0], "clips").map(x => x._nodeId)).not.toContain(clips[1]._nodeId);
  expect(v.runtime.readMany(tracks[0], "clips").map(x => x._nodeId)).toContain(clips[0]._nodeId);
  expect(v.renderer.findByTestId("inspector-empty")).toBeDefined();
  await select(clips[0]);
  await driver.run("deleteSelectedClip");
  await v.untilOne(v.rootScope, "selectedClip", x => x === null);
  await v.untilMany(tracks[0], "clips", n => n === 2);
  v.settle();
  for (const id of ids) expect(v.renderer.findByTestId(id)!.customProps?.tabIndex).toBe(-1);
 });

 test("native Split preserves linked resource and track, splits canonical timing and rendered widths", async () => {
  const { v, driver, project, tracks, select, read } = await mount();
  const resources = await driver.waitMany(project, "resources", 2);
  await driver.run("addActiveProjectResourceToTimeline", resources[0]._nodeId);
  const added = await v.untilMany(tracks[0], "clips", n => n === 5);
  const clip = added[4];
  expect((await driver.waitOne(clip, "resource"))._nodeId).toBe(resources[0]._nodeId);
  await driver.run("setTimelineAttrs", { start: 0, in: 3, duration: 6 }, clip);
  await select(clip);
  await v.untilAttr(clip, "duration", x => x === 6);
  await v.untilAttr(clip, "in", x => x === 3);
  v.settle();
  const ruler = v.centerOf("timeline-ruler").bounds;
  await driver.run("commitSeek", { cursor: 2 });
  await v.untilAttr(v.rootScope, "cursor", x => x === 2);
  v.settle(); v.click("timeline-split");
  const split = await v.untilMany(tracks[0], "clips", n => n === 6);
  const right = split.find(x => !added.some(old => old._nodeId === x._nodeId))!;
  await v.untilAttr(clip, "duration", x => x === 2);
  for (const [attr, expected] of [["start", 2], ["duration", 4], ["in", 5]] as const) {
   await v.untilAttr(right, attr, x => x === expected);
  }
  expect(read(clip)).toMatchObject({ start: 0, duration: 2, in: 3 });
  expect((await driver.waitOne(right, "resource"))._nodeId).toBe(resources[0]._nodeId);
  const releaseTrack = v.runtime.mountShape(right, defineShape({ one: { track: defineShape({ attrs: ["name"] }) } }));
  try { expect((await driver.waitOne(right, "track"))._nodeId).toBe(tracks[0]._nodeId); } finally { releaseTrack(); }
  v.settle();
  const leftName = read(clip).name;
  const rightName = await v.untilAttr(right, "name", x => typeof x === "string");
  expect(rightName).toBe(leftName);
  v.settle();
  const affected = v.findAll("clip").filter(e => e.customProps?.["aria-label"] === leftName);
  expect(affected).toHaveLength(2);
  const entries = affected.map(element => ({ element, bounds: v.renderer.getElementBounds(element.id)! })).sort((a, b) => a.bounds.x - b.bounds.x);
  expect(entries[0].element.customProps?.["aria-selected"]).toBe(true);
  expect(entries[1].element.customProps?.["aria-selected"]).toBe(false);
  const bounds = entries.map(entry => entry.bounds);
  // Timeline widths are border-box; native reported content bounds exclude both borders.
  expect(Math.abs(bounds[0].width - (2 * 56 - 4))).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds[1].width - (4 * 56 - 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds[0].x - ruler.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(bounds[1].x - (ruler.x + 2 * 56))).toBeLessThanOrEqual(2);
  // Normalize content top to outer top with the same selected/unselected borders.
  expect(bounds[1].y - 1).toBe(bounds[0].y - 2);
  expect(v.texts().some(text => text.includes(" - V1 - 0.0s - Duration 2.0s"))).toBe(true);
 });

 test("boundary and outside cursor Split leaves public clip membership and timing unchanged", async () => {
  const { v, driver, tracks, clips, select, read } = await mount();
  await select(clips[1]);
  const before = read(clips[1]);
  const members = v.runtime.readMany(tracks[0], "clips").map(x => x._nodeId);
  for (const cursor of [0, 4, 10.5, 12]) {
   await driver.run("commitSeek", { cursor });
   await v.untilAttr(v.rootScope, "cursor", x => x === cursor);
   v.settle(); v.click("timeline-split");
   // Public completion step after the native command, then independent public readback.
   await driver.run("setActiveInspectorTab", "edit");
   expect((await v.untilMany(tracks[0], "clips", () => true)).map(x => x._nodeId)).toEqual(members);
   expect(read(clips[1])).toEqual(before);
  }
 });

 test("receiver readiness requires project, metadata, identity and finite cursor; late old attrs cannot arm a new selection", () => {
  const fixture = createSkeletonRaceFixture([]);
  const root = createTestRoot();
  try {
   root.render(() => <div style={{ display: "flex", width: 1000, height: 160 }}><RootScope runtime={fixture.runtime}><TimelineCommands /></RootScope></div>);
   const update = (fn: () => void) => root.flushSync(fn);
   const disabled = () => { for (const id of ids) expect(root.renderer.findByTestId(id)!.customProps?.tabIndex).toBe(-1); };
   const text = (label: string) => expect(root.renderer.getAllText()).toContain(label);
   text("Loading project…"); disabled();
   update(() => fixture.deliverActiveProjectRel("p"));
   update(() => fixture.deliverAttrs("p", { title: "" }));
   text("Loading project…"); disabled();
   update(() => fixture.deliverAttrs("root", { $meta$rels$activeProject$exists: true }));
   text("Loading selection…"); disabled();
   update(() => fixture.deliverSelectedClipRel("a"));
   update(() => fixture.deliverAttrs("a", { name: "Canonical A" }));
   update(() => fixture.deliverAttrs("root", { selectedEntityId: "a", cursor: 2 }));
   disabled();
   update(() => fixture.deliverAttrs("root", { $meta$rels$selectedClip$exists: true }));
   text("Canonical A");
   for (const id of ids) expect(root.renderer.findByTestId(id)!.customProps?.tabIndex).toBe(0);
   for (const cursor of [null, Infinity, NaN]) {
    update(() => fixture.deliverAttrs("root", { cursor }));
    expect(root.renderer.findByTestId("timeline-split")!.customProps?.tabIndex).toBe(-1);
    expect(root.renderer.findByTestId("timeline-delete")!.customProps?.tabIndex).toBe(0);
   }
   update(() => fixture.deliverSelectedClipRel("b"));
   update(() => fixture.deliverAttrs("root", { selectedEntityId: "b", cursor: 1 }));
   update(() => fixture.deliverAttrs("a", { name: "Late A" }));
   text("Loading selection…"); disabled();
   update(() => fixture.deliverAttrs("b", { name: "Canonical B" }));
   text("Canonical B"); expect(root.renderer.getAllText()).not.toContain("Late A");
   update(() => fixture.deliverAttrs("root", { selectedEntityId: "unknown" })); disabled();
   update(() => fixture.deliverAttrs("root", { $meta$rels$selectedClip$exists: false })); text("No clip selected"); disabled();
   update(() => fixture.deliverAttrs("root", { $meta$rels$activeProject$exists: false })); text("No active project"); disabled();
   expect(fixture.runtime.getSnapshot().runtimeError).toBeNull();
  } finally { root.unmount(); fixture.destroy(); }
 });
});
