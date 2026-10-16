import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { ExportRequestState } from "../../../video-editor/app/exportRequestState";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { waitForAttr, waitForManyScopes } from "../fixtures/scopeWait";
import { gpuixFixture } from "../test/mediaFixtures";
import { openRealHostFixture, type RealHostFixture } from "./realHostFixture";

// Real worker + LevelDB + registry + ffmpeg. Mutations and reads are separate
// steps; the export outcome is read from the model's `exportProgress` attr.
let host: RealHostFixture | null = null;
// A real VP9 software encode of the fixture takes several seconds.
const REAL_ENCODE_TIMEOUT_MS = 60_000;

afterEach(async () => {
	await host?.close();
	host = null;
});

const projectShape = defineShape({
	attrs: ["importProgress"],
	many: { resources: defineShape({ attrs: ["name"] }) },
});

type Progress = {
	id: string;
	stage: string;
	progress: number;
	fileName?: string;
	size?: number;
	frameCount?: number;
	error?: string;
 range?: { type: string; clipId?: string };
};

const importFixture = async (file: string) => {
	const importer = host!.attachImport();
	const root = await host!.driver.root();
	const project = await host!.driver.waitOne(root, "activeProject");
	host!.page.mountShape(project, projectShape);
	importer.requestImport([file]);
	await waitForAttr(
		host!.page,
		project,
		"importProgress",
		(value) => (value as { stage?: string } | null)?.stage === "done",
	);
	// The first import of an empty timeline also places the clip.
	await host!.driver.waitMany(project, "tracks", 2);
	return root;
};

test("exports the timeline through the media service and reports done with the file", async () => {
	host = await openRealHostFixture();
	host.attachExport();
	const root = await importFixture(await gpuixFixture("video-audio"));
	await waitForAttr(host.page, root, "previewStructure", (value) =>
		((value as { clipSources?: unknown[] } | null)?.clipSources?.length ?? 0) > 0,
	);

	const id = `export:test:${crypto.randomUUID()}`;
	await host.page.dispatchAndWait("requestProjectExport", { id, initiatedBy: root._nodeId }, root);

	const progress = (await waitForAttr(
		host.page,
		root,
		"exportProgress",
		(value) => {
			const state = value as Progress | null;
			return state?.id === id && (state.stage === "done" || state.stage === "error");
		},
	)) as Progress;

	expect(progress.error).toBeUndefined();
	expect(progress).toMatchObject({ stage: "done", progress: 100 });
	expect(progress.frameCount).toBeGreaterThan(0);
	const output = path.join(host.exportDirectory, progress.fileName!);
	expect(existsSync(output)).toBe(true);
	const probe = await host.media.probe({ requestId: "probe-output", source: { path: output } });
	expect(probe.durationSeconds).toBeGreaterThan(1.5);
	expect(probe.video).not.toBeNull();
	// The request is consumed when the job ends.
	await waitForAttr(host.page, root, "exportRequest", (value) => value === null);
}, REAL_ENCODE_TIMEOUT_MS);

test("a missing source file is an export error in the model, not a crash", async () => {
	host = await openRealHostFixture();
	host.attachExport();
	const copy = path.join(host.profileDir, "source.mp4");
	copyFileSync(await gpuixFixture("video-audio"), copy);
	const root = await importFixture(copy);
	await waitForAttr(host.page, root, "previewStructure", (value) =>
		((value as { clipSources?: unknown[] } | null)?.clipSources?.length ?? 0) > 0,
	);
	rmSync(copy);

	const id = `export:test:${crypto.randomUUID()}`;
	await host.page.dispatchAndWait("requestProjectExport", { id, initiatedBy: root._nodeId }, root);

	const progress = (await waitForAttr(
		host.page,
		root,
		"exportProgress",
		(value) => (value as Progress | null)?.id === id && (value as Progress).stage === "error",
	)) as Progress;
	expect(progress.error).toContain("missing");
});

const selectedClipExportShape = defineShape({
 many: { tracks: defineShape({ attrs: ["kind"], many: { clips: defineShape({ attrs: ["name", "mediaKind", "start", "in", "duration"], one: { resource: defineShape({ attrs: ["kind", "duration"] }) } }) } }) },
});

test("exports only the selected one-second video Clip from a longer project to a physical file", async () => {
 host = await openRealHostFixture(); host.attachExport();
 const root = await importFixture(await gpuixFixture("video-audio"));
 const project = await host.driver.waitOne(root, "activeProject");
 host.page.mountShape(project, selectedClipExportShape);
 const tracks = await host.driver.waitMany(project, "tracks", 2);
 const trackInfo = await Promise.all(tracks.map(async scope => ({ scope, kind: await host!.driver.waitAttr(scope, "kind") })));
 const videoTrack = trackInfo.find(item => item.kind === "video")!.scope;
 const importedClips = await host.driver.waitMany(videoTrack, "clips", 1);
 const clipInfo = await Promise.all(importedClips.map(async scope => ({ scope, kind: await host!.driver.waitAttr(scope, "mediaKind") })));
 const selected = clipInfo.find(item => item.kind === "video")!.scope;
 const resource = await host.driver.waitOne(selected, "resource");
 expect(await host.driver.waitAttr(resource, "kind")).toBe("video");
 expect(await host.driver.waitAttr(resource, "duration")).toBeGreaterThan(1);
 const oldIds = importedClips.map(scope => scope._nodeId);
 await host.driver.run("addResourceToTimeline", resource._nodeId, project);
 const extended = await waitForManyScopes(host.page, videoTrack, "clips", members => members.some(scope => !oldIds.includes(scope._nodeId)));
 expect(extended.map(scope => scope._nodeId)).toContain(selected._nodeId);
 expect(extended.length).toBeGreaterThan(importedClips.length);
 const later = extended.find(scope => !oldIds.includes(scope._nodeId))!;
 expect(await host.driver.waitAttr(later, "mediaKind")).toBe("video");
 const laterStart = await waitForAttr(host.page, later, "start", value => typeof value === "number") as number;
 const laterDuration = await waitForAttr(host.page, later, "duration", value => typeof value === "number") as number;
 expect(laterStart + laterDuration).toBeGreaterThan(1);
 await host.driver.run("setTimelineAttrs", { start: 0, in: 0, duration: 1 }, selected);
 expect(await waitForAttr(host.page, selected, "start", value => value === 0)).toBe(0);
 expect(await waitForAttr(host.page, selected, "in", value => value === 0)).toBe(0);
 expect(await waitForAttr(host.page, selected, "duration", value => value === 1)).toBe(1);
 expect((await host.driver.waitOne(selected, "resource"))._nodeId).toBe(resource._nodeId);
 await host.driver.run("selectEntity", selected._nodeId);
 const current = await host.driver.waitOne(root, "selectedClip"); expect(current._nodeId).toBe(selected._nodeId);
 const id = `export:${crypto.randomUUID()}`;
 await host.page.dispatchAndWait("requestSelectedClipExport", { id, initiatedBy: root._nodeId }, root);
 const request = await waitForAttr(host.page, root, "exportRequest", value => (value as ExportRequestState | null)?.id === id) as ExportRequestState;
 expect(request.plan.duration).toBeGreaterThan(1);
 expect(request.plan.clipSources).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: selected._nodeId, start: 0, duration: 1 }),
  expect.objectContaining({ id: later._nodeId, start: laterStart, duration: laterDuration }),
 ]));
 const ranged = await waitForAttr(host.page, root, "exportProgress", value => (value as Progress | null)?.id === id) as Progress;
 expect(ranged.range).toEqual({ type: "clip", clipId: selected._nodeId });
 const progress = await waitForAttr(host.page, root, "exportProgress", value => (value as Progress | null)?.id === id && ["done", "error"].includes((value as Progress).stage)) as Progress;
 expect(progress.error).toBeUndefined(); expect(progress).toMatchObject({ stage: "done", progress: 100, range: { type: "clip", clipId: selected._nodeId } });
 expect(progress.frameCount).toBeGreaterThan(0);
 const output = path.join(host.exportDirectory, progress.fileName!);
 expect(existsSync(output)).toBe(true); expect(statSync(output).size).toBeGreaterThan(0);
 const probe = await host.media.probe({ requestId: "probe-selected-output", source: { path: output } });
 expect(probe.video).not.toBeNull(); expect(probe.durationSeconds).toBeGreaterThan(0.7); expect(probe.durationSeconds).toBeLessThan(1.3);
 expect(probe.durationSeconds).toBeLessThan(request.plan.duration);
 await waitForAttr(host.page, root, "exportRequest", value => value === null);
 expect(host.page.getSnapshot().runtimeError).toBeNull();
}, REAL_ENCODE_TIMEOUT_MS);
