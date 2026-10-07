import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { waitForAttr } from "../fixtures/scopeWait";
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
