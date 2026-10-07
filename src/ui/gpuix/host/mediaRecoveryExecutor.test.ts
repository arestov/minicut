import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { waitForAttr } from "../fixtures/scopeWait";
import { gpuixFixture } from "../test/mediaFixtures";
import { openRealHostFixture, type RealHostFixture } from "./realHostFixture";

// Real worker + LevelDB + registry + ffprobe: import, restart and relink of a
// local file through the model's recovery task. Mutations and reads are separate steps.
let host: RealHostFixture | null = null;
const cleanup: string[] = [];

afterEach(async () => {
	await host?.close();
	host = null;
	for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const taskShape = defineShape({ attrs: ["phase", "reasonCode", "operationId"] });
const resourceShape = defineShape({
	attrs: [
		"name",
		"sourceKind",
		"sourceRef",
		"localMediaAvailability",
		"originalAccessStatus",
		"url",
	],
	one: { activeMediaRecoveryTask: taskShape },
});
const projectShape = defineShape({
	attrs: ["importProgress"],
	many: { resources: resourceShape },
});

/** Resolves with the first non-null value read; re-reads on every notification. */
const waitFor = <T>(
	read: () => T | null,
	subscribe: (listener: () => void) => () => void,
): Promise<T> =>
	new Promise((resolve) => {
		const check = () => {
			const value = read();
			if (value) {
				stop();
				resolve(value);
			}
		};
		const stop = subscribe(check);
		check();
	});

const activeTask = (h: RealHostFixture, resource: ReactSyncScopeHandle) =>
	waitFor(
		() => h.page.readOne(resource, "activeMediaRecoveryTask"),
		(listener) => h.page.subscribeOne(resource, "activeMediaRecoveryTask", listener),
	);

const openProject = async (profileDir: string) => {
	const h = await openRealHostFixture(profileDir);
	host = h;
	const importer = h.attachImport();
	const recovery = h.attachRecovery(importer);
	const root = await h.driver.root();
	const project = await h.driver.waitOne(root, "activeProject");
	h.page.mountShape(project, projectShape);
	return { h, importer, recovery, project };
};

test("an imported file completes its recovery task and is reported as available", async () => {
	const profile = mkdtempSync(path.join(tmpdir(), "minicut-recovery-"));
	cleanup.push(profile);
	const { h, importer, project } = await openProject(profile);

	importer.requestImport([await gpuixFixture("video-audio")]);
	const [resource] = await h.driver.waitMany(project, "resources", 1);

	const task = await activeTask(h, resource);
	await waitForAttr(h.page, task, "phase", (phase) => phase === "completed");
	const read = (name: string, expected: unknown) =>
		waitForAttr(h.page, resource, name, (value) => value === expected);
	await read("localMediaAvailability", "ready-file-handle");
	await read("originalAccessStatus", "granted");
	await read("sourceKind", "local-asset");
	await read("sourceRef", h.registry.list()[0].assetId);
});

test("after a restart the resource is restored from the registry; a missing file is source-missing and can be relinked", async () => {
	const profile = mkdtempSync(path.join(tmpdir(), "minicut-recovery-"));
	cleanup.push(profile);
	const original = path.join(profile, "clip.mp4");
	copyFileSync(await gpuixFixture("video-audio"), original);

	// First run: import and let the recovery finish.
	const first = await openProject(profile);
	first.importer.requestImport([original]);
	const [firstResource] = await first.h.driver.waitMany(first.project, "resources", 1);
	const firstTask = await activeTask(first.h, firstResource);
	await waitForAttr(first.h.page, firstTask, "phase", (phase) => phase === "completed");
	await first.h.close();
	host = null;

	// Second run, file still there: restored as available, url republished.
	const second = await openProject(profile);
	const [restored] = await second.h.driver.waitMany(second.project, "resources", 1);
	await waitForAttr(second.h.page, restored, "localMediaAvailability", (v) => v === "ready-file-handle");
	await waitForAttr(
		second.h.page,
		restored,
		"url",
		(v) => typeof v === "string" && v.startsWith("minicut-asset:"),
	);
	await second.h.close();
	host = null;

	// Third run, file moved away: source-missing, nothing is guessed.
	const moved = path.join(profile, "moved.mp4");
	renameSync(original, moved);
	const third = await openProject(profile);
	const [resource] = await third.h.driver.waitMany(third.project, "resources", 1);
	await waitForAttr(third.h.page, resource, "originalAccessStatus", (v) => v === "missing");
	const task = await activeTask(third.h, resource);
	await waitForAttr(third.h.page, task, "phase", (v) => v === "awaiting-user-action");
	await waitForAttr(third.h.page, task, "reasonCode", (v) => v === "source-missing");

	// The user picks the moved file: identical bytes are an exact match and commit.
	third.recovery.requestRelink(resource._nodeId, moved, "locate-original");
	await waitForAttr(third.h.page, resource, "originalAccessStatus", (v) => v === "granted");
	await waitForAttr(third.h.page, resource, "localMediaAvailability", (v) => v === "ready-file-handle");
	expect(third.h.registry.list()[0].path).toBe(moved);
}, 60_000);
