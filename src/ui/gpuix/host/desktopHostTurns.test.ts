import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { resolveProfileDir } from "../../../video-editor/adapters/node/desktopProfileConfig";
import { NodeLevelDbStorageOpenError } from "../../../video-editor/adapters/node/createNodeLevelDbStoragePackage";
import type { PreviewProxyStatus } from "../../../video-editor/hosts/electron/main/desktopExecutors";
import { createAssetUrl } from "../../../video-editor/hosts/electron/shared/ipcChannels";
import {
	type HeadlessDesktop,
	startHeadlessDesktop,
} from "../../../video-editor/hosts/electron/testing/headlessDesktop";
import { waitForAttr } from "../fixtures/scopeWait";
import { createScenarioDriver } from "../fixtures/scenarioDriver";
import { gpuixFixture } from "../test/mediaFixtures";
import { openRealHostFixture, type RealHostFixture } from "./realHostFixture";

// One profile, two hosts used in turn: the GPUIX real host (Bun worker, LevelDB)
// and the Electron main composition (headless: real media service and LevelDB,
// fake ipc and windows). Mutations and reads are separate steps.
let gpuix: RealHostFixture | null = null;
let electron: HeadlessDesktop | null = null;
const cleanup: string[] = [];

afterEach(async () => {
	await electron?.dispose();
	electron = null;
	await gpuix?.close();
	gpuix = null;
	for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const resourceShape = defineShape({
	attrs: ["name", "kind", "sourceKind", "sourceRef", "url", "localMediaAvailability"],
});
const projectShape = defineShape({
	attrs: ["title"],
	many: { resources: resourceShape, tracks: defineShape({ attrs: ["kind"] }) },
});

const newProfile = () => {
	const dir = mkdtempSync(path.join(tmpdir(), "minicut-turns-"));
	cleanup.push(dir);
	return dir;
};

const openGpuix = async (profileDir: string) => {
	const host = await openRealHostFixture(profileDir);
	gpuix = host;
	const importer = host.attachImport();
	host.attachRecovery();
	const root = await host.driver.root();
	const project = await host.driver.waitOne(root, "activeProject");
	host.page.mountShape(project, projectShape);
	return { host, importer, project };
};

const openElectron = async (profileDir: string) => {
	const dropped: Array<{ effect: string; reason: string }> = [];
	const messagesToWindows: string[] = [];
	const proxyListeners = new Set<() => void>();
	const proxies = new Map<string, PreviewProxyStatus>();
	/** Resolves once the proxy of an asset reaches the state (event driven). */
	const waitForProxy = (assetId: string, state: PreviewProxyStatus["state"]) =>
		new Promise<PreviewProxyStatus>((resolve) => {
			const check = () => {
				const status = proxies.get(assetId);
				if (status?.state === state) {
					proxyListeners.delete(check);
					resolve(status);
				}
			};
			proxyListeners.add(check);
			check();
		});
	const desktop = await startHeadlessDesktop({
		profileDir,
		exportDirectory: path.join(profileDir, "exports"),
		onProxyChanged: (assetId, status) => {
			proxies.set(assetId, status);
			for (const listener of [...proxyListeners]) listener();
		},
		onEffectDropped: (effect, reason) => dropped.push({ effect, reason }),
		observeWindowMessages: (_window, message) =>
			messagesToWindows.push(String((message as { type?: unknown }).type)),
	});
	electron = desktop;
	const window = desktop.openWindow(1);
	const driver = createScenarioDriver(window.page);
	const root = await driver.root();
	const project = await driver.waitOne(root, "activeProject");
	window.page.mountShape(project, projectShape);
	return { desktop, window, driver, root, project, dropped, messagesToWindows, waitForProxy };
};

test("a workspace made in GPUIX opens in Electron with its media, an edit there is seen back in GPUIX", async () => {
	const profile = newProfile();
	const clip = path.join(profile, "clip.mp4");
	copyFileSync(await gpuixFixture("video-audio"), clip);

	// GPUIX: project, imported file (asset id in the registry), then close.
	const first = await openGpuix(profile);
	first.importer.requestImport([clip]);
	const [firstResource] = await first.host.driver.waitMany(first.project, "resources", 1);
	const assetId = String(
		await waitForAttr(first.host.page, firstResource, "sourceRef", (v) => typeof v === "string"),
	);
	await waitForAttr(first.host.page, firstResource, "localMediaAvailability", (v) => v === "ready-file-handle");
	await first.host.close();
	gpuix = null;

	// Electron: same project, same resource id, republished with its own url.
	const second = await openElectron(profile);
	const [resource] = await second.driver.waitMany(second.project, "resources", 1);
	expect(await waitForAttr(second.window.page, second.project, "title", (v) => typeof v === "string")).toBe("Project 1");
	expect(await second.driver.waitAttr(resource, "sourceKind")).toBe("local-asset");
	expect(await second.driver.waitAttr(resource, "sourceRef")).toBe(assetId);
	// Boot restore ran in main and gave the renderer a url it can play.
	await waitForAttr(second.window.page, resource, "url", (v) => v === createAssetUrl(assetId));
	await waitForAttr(second.window.page, resource, "localMediaAvailability", (v) => v === "ready-file-handle");
	const served = await second.desktop.serve(createAssetUrl(assetId));
	expect(served.status).toBe(200);
	expect(second.desktop.app.assets.get(assetId)?.path.toLowerCase()).toBe(clip.toLowerCase());
	// The restore request never went to a window, and nothing was left without an owner.
	expect(second.messagesToWindows.filter((type) => type === "dkt:media-recovery-request")).toEqual([]);
	expect(second.dropped.filter((entry) => entry.effect !== "dkt:playback-run-request")).toEqual([]);

	await second.driver.run("addTrack", { kind: "video", name: "From Electron" }, second.project);
	await second.driver.waitMany(second.project, "tracks", 3);
	await second.desktop.dispose();
	electron = null;

	// GPUIX again: the Electron edit is there and the url is GPUIX's own again.
	const third = await openGpuix(profile);
	await third.host.driver.waitMany(third.project, "tracks", 3);
	const [again] = await third.host.driver.waitMany(third.project, "resources", 1);
	await waitForAttr(third.host.page, again, "sourceRef", (v) => v === assetId);
	await waitForAttr(third.host.page, again, "url", (v) => v === `minicut-asset:${assetId}`);
});

test("a workspace made in Electron opens in GPUIX with its media", async () => {
	const profile = newProfile();
	const clip = path.join(profile, "clip.mp4");
	copyFileSync(await gpuixFixture("video-audio"), clip);

	const first = await openElectron(profile);
	const staged = first.window.stage([clip]);
	if (!staged.ok) throw new Error(staged.reason);
	await first.driver.run("requestImportFiles", { inputBatchHandleId: staged.batchId });
	const [imported] = await first.driver.waitMany(first.project, "resources", 1);
	const assetId = String(
		await waitForAttr(first.window.page, imported, "sourceRef", (v) => typeof v === "string"),
	);
	expect(await first.driver.waitAttr(imported, "sourceKind")).toBe("local-asset");
	await waitForAttr(first.window.page, imported, "url", (v) => v === createAssetUrl(assetId));
	// The scrub proxy was made by the media service on import, in the shared profile cache.
	const proxy = await first.waitForProxy(assetId, "ready");
	if (proxy.state !== "ready") throw new Error("proxy is not ready");
	expect(proxy.path.startsWith(path.join(profile, "cache", "preview-proxies"))).toBe(true);
	const proxyResponse = await first.desktop.serve("/proxy/" + assetId);
	expect(proxyResponse.status).toBe(200);
	expect(proxyResponse.headers.get("content-type")).toBe("video/mp4");
	await first.desktop.dispose();
	electron = null;

	const second = await openGpuix(profile);
	const [resource] = await second.host.driver.waitMany(second.project, "resources", 1);
	await waitForAttr(second.host.page, resource, "sourceRef", (v) => v === assetId);
	await waitForAttr(second.host.page, resource, "localMediaAvailability", (v) => v === "ready-file-handle");
	expect(second.host.registry.get(assetId)?.path.toLowerCase()).toBe(clip.toLowerCase());
	const probed = await second.host.media.probe({
		requestId: "probe",
		source: { assetId },
	});
	expect(probed.video).not.toBeNull();
});

test("a file moved away between the turns is reported as missing, not guessed", async () => {
	const profile = newProfile();
	const clip = path.join(profile, "clip.mp4");
	copyFileSync(await gpuixFixture("video-audio"), clip);

	const first = await openGpuix(profile);
	first.importer.requestImport([clip]);
	const [firstResource] = await first.host.driver.waitMany(first.project, "resources", 1);
	await waitForAttr(first.host.page, firstResource, "localMediaAvailability", (v) => v === "ready-file-handle");
	await first.host.close();
	gpuix = null;
	renameSync(clip, path.join(profile, "moved.mp4"));

	const second = await openElectron(profile);
	const [resource] = await second.driver.waitMany(second.project, "resources", 1);
	await waitForAttr(second.window.page, resource, "localMediaAvailability", (v) => v === "unavailable");
});

test("the second app on a held profile fails with a typed error, in both directions", async () => {
	const profile = newProfile();

	const held = await openElectron(profile);
	await expect(openRealHostFixture(profile)).rejects.toThrow(/LevelDB/);
	await held.desktop.dispose();
	electron = null;

	const first = await openGpuix(profile);
	let failure: unknown = null;
	try {
		electron = await startHeadlessDesktop({
			profileDir: profile,
			exportDirectory: path.join(profile, "exports"),
		});
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(NodeLevelDbStorageOpenError);
	await first.host.close();
	gpuix = null;

	// After the first app closed, the profile opens again.
	const again = await openElectron(profile);
	expect(again.desktop.app.host.identity.storagePath).toContain("workspaces");
});

test("both hosts resolve the same profile folder from MINICUT_PROFILE_DIR", () => {
	const env = { MINICUT_PROFILE_DIR: path.join(tmpdir(), "shared-profile") };

	expect(resolveProfileDir(env)).toBe(path.resolve(env.MINICUT_PROFILE_DIR));
});
