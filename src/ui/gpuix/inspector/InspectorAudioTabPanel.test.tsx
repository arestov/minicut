import { afterEach, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import { createSkeletonRaceFixture, type SkeletonRaceFixture } from "../fixtures/skeletonRace";
import { renderWithScenario } from "../test/renderApp";
import { Inspector } from "./Inspector";
let view: Awaited<ReturnType<typeof renderWithScenario>> | null = null;
let fixture: SkeletonRaceFixture | null = null;
afterEach(() => { view?.destroy(); view = null; fixture?.destroy(); fixture = null; });
const mount = async () => {
 const v = await renderWithScenario("timeline", () => <div style={{ display: "flex", width: 400, height: 600 }}><Inspector /></div>);
 view = v;
 const driver = v.verifier();
 const project = await driver.waitOne(v.rootScope, "activeProject");
 const tracks = await driver.waitMany(project, "tracks", 3);
 const audio = await driver.waitMany(tracks[1], "clips", 2);
 const video = await driver.waitMany(tracks[0], "clips", 2);
 await driver.run("setActiveInspectorTab", "audio");
 await v.untilAttr(v.rootScope, "activeInspectorTab", x => x === "audio");
 await driver.run("selectEntity", audio[0]._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === audio[0]._nodeId);
 await v.untilAttr(audio[0], "mediaKind", x => x === "audio");
 await v.untilAttr(audio[0], "audio", x => x !== undefined);
 v.settle();
 const key = (keys: string) => v.renderer.nativeSimulateKeystrokes(v.renderer.findByTestId("inspector-audio-gain")!.id, keys);
 return { v, driver, project, tracks, audio, video, key };
};
const gain = (x: unknown) => (x as { gain?: number } | null)?.gain;

test("native audio gain reads back on the Clip and preserves pan", async () => {
 const { v, driver, audio, key } = await mount();
 await driver.run("setAudio", { gain: 1, pan: 0.25 }, audio[0]);
 await v.untilAttr(audio[0], "audio", x => (x as { pan: number }).pan === 0.25);
 for (const [keys, expected] of [["right", 1.01], ["home", 0], ["end", 1.5]] as const) {
  key(keys);
  const value = await v.untilAttr(audio[0], "audio", x => gain(x) === expected) as { gain: number; pan: number };
  v.settle();
  expect(value.pan).toBe(0.25);
  expect(v.texts()).toContain(`Gain ${Math.round(expected * 100)}%`);
 }
 await driver.run("setAudio", { gain: 0.75 }, audio[0]);
 await v.untilAttr(audio[0], "audio", x => gain(x) === 0.75);
 v.settle();
 expect(v.renderer.findByTestId("inspector-audio-gain")!.customProps?.["aria-valuetext"]).toBe("75%");
 expect(v.runtime.getSnapshot().runtimeError).toBeNull();
});

test("non-audio and selection replacement disable edits and cancel the old drag", async () => {
 const { v, driver, audio, video, key } = await mount();
 const rail = v.renderer.findByTestId("inspector-audio-gain")!;
 const bounds = v.renderer.getElementBounds(rail.id)!;
 v.renderer.nativeSimulateMouseDown(bounds.x + 5, bounds.y + bounds.height / 2);
 await v.untilAttr(audio[0], "audio", x => gain(x) === 0);
 await driver.run("selectEntity", video[0]._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === video[0]._nodeId);
 await v.untilAttr(video[0], "mediaKind", x => x === "video");
 const videoAudio = await v.untilAttr(video[0], "audio", x => x !== undefined);
 v.settle();
 v.renderer.nativeSimulateMouseMove(bounds.x + bounds.width - 5, bounds.y + bounds.height / 2, 0);
 v.renderer.nativeSimulateMouseUp(bounds.x + bounds.width - 5, bounds.y + bounds.height / 2);
 key("end");
 await driver.run("setActiveInspectorTab", "audio");
 expect(await v.untilAttr(video[0], "audio", () => true)).toEqual(videoAudio);
 expect(await v.untilAttr(audio[0], "audio", x => gain(x) === 0)).toEqual({ gain: 0, pan: 0 });
 v.settle();
 expect(v.texts()).toContain("Select an audio clip to edit playback settings.");
 expect(v.renderer.findByTestId("inspector-audio-gain")!.customProps?.tabIndex).toBe(-1);
 expect(v.runtime.getSnapshot().runtimeError).toBeNull();
});

test("Clip media kind has priority over the linked Resource, and fallback edits remain Clip scoped", async () => {
 const { v, driver, project, tracks, key } = await mount();
 const resources = await driver.waitMany(project, "resources", 2);
 await driver.run("addResourceToTimeline", resources[1]._nodeId, project);
 const clips = await driver.waitMany(tracks[1], "clips", 3);
 const clip = clips[2];
 await driver.run("selectEntity", clip._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clip._nodeId);
 const resource = await v.untilOne(clip, "resource", s => s !== null);
 expect(resource?._nodeId).toBe(resources[1]._nodeId);
 await v.untilAttr(resource!, "kind", x => x === "audio");
 await v.untilAttr(clip, "mediaKind", x => x === "audio");
 await driver.run("setMediaKind", "video", clip);
 await v.untilAttr(clip, "mediaKind", x => x === "video");
 v.settle();
 expect(v.texts()).toContain("Select an audio clip to edit playback settings.");
 expect(v.renderer.findByTestId("inspector-audio-gain")!.customProps?.tabIndex).toBe(-1);
 const start = await v.untilAttr(clip, "start", x => typeof x === "number");
 await driver.run("setClipAttrs", { name: "Resource fallback", mediaKind: null, start, in: 0, duration: 90 }, clip);
 await v.untilAttr(clip, "mediaKind", x => x === null);
 v.settle();
 expect(v.texts()).toContain("Gain 100%");
 key("right");
 await v.untilAttr(clip, "audio", x => gain(x) === 1.01);
 v.settle();
 expect(v.texts()).toContain("Gain 101%");
 expect(await v.untilAttr(resource!, "kind", x => x === "audio")).toBe("audio");
 expect(v.runtime.getSnapshot().runtimeError).toBeNull();
});

test("receiver late Resource kind enables gain without guessing or writes", () => {
 const current = createSkeletonRaceFixture([]); fixture = current;
 const root = createTestRoot();
 root.render(() => <div style={{ display: "flex", width: 400, height: 600 }}><RootScope runtime={current.runtime}><Inspector /></RootScope></div>);
 root.flushSync(() => {
  current.deliverAttrs("root", { activeInspectorTab: "audio" });
  current.deliverSelectedClipRel("clip");
  current.deliverAttrs("clip", { name: "Late audio", mediaKind: null });
  current.deliverResourceRel("clip", "resource");
 });
 expect(root.renderer.getAllText()).toContain("Select an audio clip to edit playback settings.");
 expect(root.renderer.findByTestId("inspector-audio-gain")!.customProps?.tabIndex).toBe(-1);
 root.flushSync(() => current.deliverAttrs("resource", { kind: "audio" }));
 expect(root.renderer.getAllText()).toContain("Gain 100%");
 expect(root.renderer.findByTestId("inspector-audio-gain")!.customProps?.tabIndex).toBe(0);
 root.flushSync(() => current.deliverAttrs("clip", { mediaKind: "video" }));
 expect(root.renderer.findByTestId("inspector-audio-gain")!.customProps?.tabIndex).toBe(-1);
 root.flushSync(() => current.deliverAttrs("clip", { mediaKind: "audio" }));
 root.flushSync(() => current.deliverAttrs("resource", { kind: "video" }));
 expect(root.renderer.getAllText()).toContain("Gain 100%");
 root.unmount();
});
