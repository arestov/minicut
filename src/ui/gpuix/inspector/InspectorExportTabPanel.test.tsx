import { afterEach, expect, test } from "bun:test";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import type { ExportRequestState } from "../../../video-editor/app/exportRequestState";
import type { ExportProgressState } from "../../../video-editor/app/exportProgressState";
import { HostServicesContext } from "../host/hostServices";
import { createSkeletonRaceFixture } from "../fixtures/skeletonRace";
import { AppShell } from "../AppShell";
import { useReviewMode } from "../review/reviewModeState";
import { renderWithScenario } from "../test/renderApp";
import { Inspector } from "./Inspector";
type View = Awaited<ReturnType<typeof renderWithScenario>>;
let view: View | null = null;
afterEach(() => { const error = view?.runtime.getSnapshot().runtimeError; view?.destroy(); view = null; expect(error ?? null).toBeNull(); });
const mount = async (directory?: string, withReview = false) => {
 let review: ReturnType<typeof useReviewMode> | null = null;
 const ReviewFixture = () => { review = useReviewMode(); return <Inspector />; };
 const content = () => withReview ? <AppShell inspector={<ReviewFixture />} /> : <div style={{ display: "flex", width: 400, height: 600 }}><Inspector /></div>;
 const v = await renderWithScenario("timeline", () => directory === undefined ? content() : <HostServicesContext.Provider value={{ exportDirectory: directory, importFromDialog: async () => {}, relinkFromDialog: async () => {} }}>{content()}</HostServicesContext.Provider>);
 view = v;
 const driver = v.verifier();
 const project = await driver.waitOne(v.rootScope, "activeProject");
 const tracks = await driver.waitMany(project, "tracks", 3);
 const clips = await driver.waitMany(tracks[0], "clips", 2);
 await driver.run("setActiveInspectorTab", "export");
 await v.untilAttr(v.rootScope, "activeInspectorTab", x => x === "export");
 await driver.run("selectEntity", clips[0]._nodeId);
 await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[0]._nodeId);
 await v.untilAttr(clips[0], "name", x => x === "Intro"); v.settle();
 return { v, driver, project, clips, review: () => review! };
};
const queue = async (v: View, clipId: string, keyboard = false) => {
 const previous = await v.untilAttr(v.rootScope, "exportRequest", () => true) as ExportRequestState | null;
 if (keyboard) v.renderer.nativeSimulateKeystrokes(v.renderer.findByTestId("inspector-export-queue")!.id, "enter"); else v.click("inspector-export-queue");
 const request = await v.untilAttr(v.rootScope, "exportRequest", x => !!x && (x as ExportRequestState).id !== previous?.id && (x as ExportRequestState).range.type === "clip" && ((x as ExportRequestState).range as { clipId: string }).clipId === clipId) as ExportRequestState;
 const progress = await v.untilAttr(v.rootScope, "exportProgress", x => (x as ExportProgressState | null)?.id === request.id && (x as ExportProgressState).stage === "queued") as ExportProgressState;
 v.settle(); return { request, progress };
};
const report = async (v: View, request: ExportRequestState, stage: ExportProgressState["stage"], progress = 0, extra: Record<string, unknown> = {}) => {
 await v.runtime.dispatchAndWait("setExportProgress", { id: request.id, range: request.range, initiatedBy: request.initiatedBy, stage, progress, ...extra }, null);
 const result = await v.untilAttr(v.rootScope, "exportProgress", x => (x as ExportProgressState | null)?.id === request.id && (x as ExportProgressState).stage === stage);
 v.settle(); return result as ExportProgressState;
};
const queueEnabled = (v: View) => v.renderer.findByTestId("inspector-export-queue")!.customProps?.tabIndex === 0;

test("native queue action creates the selected range and model plan, then shows actual percent stages", async () => {
 const { v, driver, clips, project } = await mount();
 expect(v.texts()).toContain("Range Clip"); expect(v.texts()).toContain("Format WebM"); expect(v.texts()).toContain("Quality High");
 const { request, progress } = await queue(v, clips[0]._nodeId);
 expect(request.id).toMatch(/^export:[0-9a-f-]{36}$/); expect(progress.id).toBe(request.id);
 expect(request.initiatedBy).toBe(v.rootScope._nodeId); expect(request.range).toEqual({ type: "clip", clipId: clips[0]._nodeId }); expect(request.format).toBe("video-webm");
 expect(request.plan.projectId).toBe(project._nodeId); expect(request.plan.clipSources.length).toBeGreaterThan(0); expect(request.plan.duration).toBeGreaterThan(4);
 expect(v.texts()).toContain("Rendering queued 0%"); expect(queueEnabled(v)).toBe(false);
 v.renderer.nativeSimulateKeystrokes(v.renderer.findByTestId("inspector-export-queue")!.id, "enter"); await driver.run("setActiveInspectorTab", "export");
 expect((await v.untilAttr(v.rootScope, "exportRequest", () => true) as ExportRequestState).id).toBe(request.id);
 for (const stage of ["rendering", "finalizing"] as const) {
  await report(v, request, stage, 40);
  expect(v.texts()).toContain(`Rendering ${stage} 40%`); expect(v.texts()).toContain(`Rendering export file for Intro: ${stage} 40%`); expect(queueEnabled(v)).toBe(false);
 }
});

for (const directory of [undefined, "fixture-exports", ""]) test(`done completion metadata and honest host folder: ${directory === undefined ? "no host" : directory || "empty folder"}`, async () => {
 const { v, clips } = await mount(directory);
 const { request } = await queue(v, clips[0]._nodeId, true);
 await report(v, request, "done", 100, { frameCount: 60, size: 2048, fileName: "clip.webm" });
 expect(v.texts()).toContain("Export ready: 60 frames · 2048 bytes · clip.webm"); expect(queueEnabled(v)).toBe(true);
 if (directory) { expect(v.texts()).toContain("Saved file: clip.webm"); expect(v.texts()).toContain(`Export folder: ${directory}`); }
 else expect(v.texts().some(text => text.startsWith("Saved file:") || text.startsWith("Export folder:"))).toBe(false);
 const next = await queue(v, clips[0]._nodeId);
 await report(v, next.request, "done", 100);
 expect(v.texts()).toContain("Export ready: 0 frames · 0 bytes");
 expect(v.texts().some(text => text.startsWith("Saved file:") || text.startsWith("Export folder:"))).toBe(false);
 expect(v.texts().some(text => /Download|Reveal|Open file/.test(text))).toBe(false);
});

test("explicit and fallback errors, idle and cancelled allow queue without saved status", async () => {
 const { v, clips } = await mount("fixture-exports");
 for (const [stage, error] of [["error", "encoder lost"], ["error", undefined], ["idle", undefined], ["cancelled", undefined]] as const) {
  const { request } = await queue(v, clips[0]._nodeId);
  await report(v, request, stage, 10, error ? { error } : {});
  if (stage === "error") expect(v.texts()).toContain(`Export failed: ${error ?? "Unknown error"}`);
  else expect(v.texts().some(text => text.startsWith("Export failed:") || text.startsWith("Export ready:") || text.startsWith("Rendering export"))).toBe(false);
  expect(queueEnabled(v)).toBe(true); expect(v.texts().some(text => text.startsWith("Saved file:") || text.startsWith("Export folder:"))).toBe(false);
 }
});

test("unrelated project or Clip progress does not disable or claim completion for selection", async () => {
 const { v, clips } = await mount("fixture-exports");
 for (const range of [{ type: "project" }, { type: "clip", clipId: clips[1]._nodeId }]) {
  const { request } = await queue(v, clips[0]._nodeId);
  await report(v, request, "rendering", 40, { range });
  expect(queueEnabled(v)).toBe(true); expect(v.texts()).toContain("Queue clip export"); expect(v.texts().some(text => text.startsWith("Rendering export file"))).toBe(false);
  await report(v, request, "done", 100, { range, fileName: "other.webm" });
  expect(v.texts().some(text => text.startsWith("Export ready:") || text.startsWith("Saved file:") || text.startsWith("Export folder:"))).toBe(false);
 }
});

test("selection replacement hides old running and completed export, review return follows canonical state", async () => {
 const { v, driver, clips, review } = await mount("fixture-exports", true);
 const { request } = await queue(v, clips[0]._nodeId);
 await driver.run("selectEntity", clips[1]._nodeId); await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[1]._nodeId); await v.untilAttr(clips[1], "name", x => typeof x === "string"); v.settle();
 expect(queueEnabled(v)).toBe(true); expect(v.texts().some(text => text.startsWith("Rendering export file"))).toBe(false);
 await report(v, request, "done", 100, { fileName: "old.webm", frameCount: 20, size: 200 });
 expect(v.texts().some(text => text.startsWith("Export ready:") || text.startsWith("Saved file:") || text.startsWith("Export folder:"))).toBe(false);
 review().open(); v.settle(); expect(v.findAll("inspector-export-controls")).toHaveLength(0);
 review().close(); v.settle(); expect(v.findAll("inspector-export-controls")).toHaveLength(1); expect(queueEnabled(v)).toBe(true);
 await driver.run("selectEntity", null); await v.untilOne(v.rootScope, "selectedClip", s => s === null); v.settle(); expect(v.findAll("inspector-export-controls")).toHaveLength(0);
 await driver.run("selectEntity", clips[1]._nodeId); await v.untilOne(v.rootScope, "selectedClip", s => s?._nodeId === clips[1]._nodeId); v.settle();
 const running = await queue(v, clips[1]._nodeId);
 v.root.unmount();
 await v.runtime.dispatchAndWait("setExportProgress", { id: running.request.id, range: running.request.range, stage: "done", progress: 100, fileName: "after-unmount.webm", initiatedBy: v.rootScope._nodeId }, null);
 expect((await v.untilAttr(v.rootScope, "exportProgress", value => (value as ExportProgressState | null)?.id === running.request.id && (value as ExportProgressState).stage === "done") as ExportProgressState).fileName).toBe("after-unmount.webm");
 expect(v.runtime.getSnapshot().runtimeError).toBeNull();
});

test("empty and late name receiver never exposes queue before selected name readiness", () => {
 const current = createSkeletonRaceFixture([]); const root = createTestRoot();
 try {
  root.render(() => <div style={{ display: "flex", width: 400, height: 600 }}><RootScope runtime={current.runtime}><Inspector /></RootScope></div>);
  root.flushSync(() => current.deliverAttrs("root", { activeInspectorTab: "export" })); expect(root.renderer.findByTestId("inspector-export-queue")).toBeUndefined();
  root.flushSync(() => current.deliverSelectedClipRel("clip")); expect(root.renderer.findByTestId("inspector-export-queue")).toBeUndefined();
  root.flushSync(() => current.deliverAttrs("clip", { name: "Late export" })); expect(root.renderer.findByTestId("inspector-export-queue")).toBeDefined();
  expect(current.runtime.getSnapshot().runtimeError).toBeNull();
 } finally { root.unmount(); current.destroy(); }
});
