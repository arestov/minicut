import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import { createMiniCutPageSyncRuntime } from "../../../video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import { waitForAttr } from "../fixtures/scopeWait";
import { createScenarioDriver, type ScenarioDriver } from "../fixtures/scenarioDriver";
import { DktWorkerStartError, spawnDktWorker, type DktWorkerHandle } from "./spawnDktWorker";

// Window-free test of the real host: DKT on LevelDB inside a Bun worker,
// reachable only through the DKT MessagePort.
let profileDir: string | null = null;
let handle: DktWorkerHandle | null = null;
let page: PageSyncRuntime | null = null;
let driver: ScenarioDriver | null = null;

const connect = async (dir: string) => {
	handle = await spawnDktWorker({ profileDir: dir });
	page = createMiniCutPageSyncRuntime({ transport: handle.transport });
	page.bootstrap({ sessionKey: "gpuix-real-host-test" });
	driver = createScenarioDriver(page);
	return { handle, page, driver };
};

const close = async () => {
	driver?.destroy();
	page?.destroy();
	await handle?.dispose();
	driver = null;
	page = null;
	handle = null;
};

afterEach(async () => {
	await close();
	if (profileDir) rmSync(profileDir, { recursive: true, force: true });
	profileDir = null;
});

test("starts the real runtime on LevelDB and restores the project after restart", async () => {
	profileDir = mkdtempSync(path.join(tmpdir(), "minicut-gpuix-host-"));

	const first = await connect(profileDir);
	expect(first.handle.identity.storagePath).toContain(profileDir);
	const root = await first.driver.root();
	// The runtime opens the empty workspace with a default project.
	const project = await first.driver.waitOne(root, "activeProject");
	await first.driver.run("renameProject", { title: "Persisted project" }, project);
	await waitForAttr(first.page, project, "title", (title) => title === "Persisted project");
	await close();

	// Same profile again: the project comes from LevelDB, not from a new create.
	const second = await connect(profileDir);
	const restoredRoot = await second.driver.root();
	const restored = await second.driver.waitOne(restoredRoot, "activeProject");
	await waitForAttr(second.page, restored, "title", (title) => title === "Persisted project");
	expect(second.handle.identity.peerId).toBe(first.handle.identity.peerId);
});

test("a second process-level open of the same profile fails with a clear start error", async () => {
	profileDir = mkdtempSync(path.join(tmpdir(), "minicut-gpuix-host-"));
	await connect(profileDir);

	const error = await spawnDktWorker({ profileDir }).then(
		() => null,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(DktWorkerStartError);
	expect((error as DktWorkerStartError).message).toContain("LevelDB");
});

test("the desktop worker provides the media restore runtime: the model schedules restore requests for the attended project after a restart", async () => {
	profileDir = mkdtempSync(path.join(tmpdir(), "minicut-gpuix-host-"));

	const first = await connect(profileDir);
	const root = await first.driver.root();
	const project = await first.driver.waitOne(root, "activeProject");
	await first.driver.run(
		"importResource",
		{
			name: "restore.webm",
			kind: "video",
			url: "",
			mime: "video/webm",
			duration: 2,
			status: "ready",
			operationId: "import:restore.webm",
			attemptId: "import:restore.webm:attempt",
			bootId: "import-boot",
			recoveryKind: "import",
			intent: "restore",
			original: { kind: "video", duration: 2, streams: { videoStreams: 1, audioStreams: null } },
			requiredSourceEnd: 2,
			createdAt: 1,
			updatedAt: 1,
		},
		project,
	);
	const [resource] = await first.driver.waitMany(project, "resources", 1);
	const resourceId = resource!._nodeId;
	await close();

	// Second boot: no executor is attached, only the model's own requests are seen.
	handle = await spawnDktWorker({ profileDir });
	page = createMiniCutPageSyncRuntime({ transport: handle.transport });
	const requests: Array<Record<string, unknown>> = [];
	const arrived = new Promise<void>((resolve) => {
		page!.subscribeRuntimeTaskRequests?.("$fx_mediaRecovery", (payload) => {
			requests.push(payload as Record<string, unknown>);
			if (String((payload as { operationId?: unknown }).operationId).startsWith("restore:")) resolve();
		});
	});
	page.bootstrap({ sessionKey: "gpuix-real-host-test" });
	await arrived;

	const restores = requests.filter((request) => String(request.operationId).startsWith("restore:"));
	expect(restores).toHaveLength(1);
	expect(restores[0]).toMatchObject({ resourceId, intent: "restore" });
});
