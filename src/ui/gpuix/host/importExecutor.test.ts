import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { waitForAttr } from "../fixtures/scopeWait";
import { gpuixFixture } from "../test/mediaFixtures";
import { openRealHostFixture, type RealHostFixture } from "./realHostFixture";

// Real worker + real LevelDB + real ffprobe; no window. Mutations
// (requestImport) and reads (waitForAttr after the sync arrives) are separate steps.
let host: RealHostFixture | null = null;

afterEach(async () => {
	await host?.close();
	host = null;
});

const resourceShape = defineShape({
	attrs: ["name", "kind", "duration", "size", "url", "sourceKind", "sourceRef", "contentFingerprint", "status"],
});
const projectShape = defineShape({
	attrs: ["importProgress", "lastImportError"],
	many: { resources: resourceShape },
});

test("imports a picked file through the real model: registry id, probe metadata, progress", async () => {
	host = await openRealHostFixture();
	const importer = host.attachImport();
	const video = await gpuixFixture("video-audio");

	const root = await host.driver.root();
	const project = await host.driver.waitOne(root, "activeProject");
	host.page.mountShape(project, projectShape);

	expect(importer.requestImport([video])).not.toBeNull();

	const resources = await host.driver.waitMany(project, "resources", 1);
	const resource = resources[0];
	await waitForAttr(host.page, resource, "sourceRef", (value) => typeof value === "string");

	const asset = host.registry.list().find((entry) => entry.path === video);
	expect(asset).toBeDefined();
	const read = (name: string) => waitForAttr(host!.page, resource, name, (value) => value !== undefined);
	expect(await read("name")).toBe(path.basename(video));
	expect(await read("kind")).toBe("video");
	expect(await read("duration")).toBeCloseTo(2, 0);
	expect(await read("sourceRef")).toBe(asset!.assetId);
	expect(await read("url")).toBe(`minicut-asset:${asset!.assetId}`);
	expect(await read("contentFingerprint")).toEqual(expect.any(String));

	const progress = (await waitForAttr(
		host.page,
		project,
		"importProgress",
		(value) => (value as { stage?: string } | null)?.stage === "done",
	)) as { processed: number; total: number };
	expect(progress).toMatchObject({ stage: "done", processed: 1, total: 1 });
});

test("a file that is not media is reported as an import error and imports nothing", async () => {
	host = await openRealHostFixture();
	const importer = host.attachImport();
	const bogus = path.join(host.profileDir, "notes.txt");
	writeFileSync(bogus, "not media");

	const root = await host.driver.root();
	const project = await host.driver.waitOne(root, "activeProject");
	host.page.mountShape(project, projectShape);

	importer.requestImport([bogus]);

	const error = await waitForAttr(
		host.page,
		project,
		"lastImportError",
		(value) => typeof value === "string" && value.length > 0,
	);
	expect(String(error)).toContain("notes.txt");
	const progress = (await waitForAttr(
		host.page,
		project,
		"importProgress",
		(value) => (value as { stage?: string } | null)?.stage === "error",
	)) as { processed: number; total: number };
	expect(progress).toMatchObject({ processed: 1, total: 1 });
	expect(host.page.readMany(project, "resources")).toHaveLength(0);
});
