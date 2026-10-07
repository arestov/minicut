import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { waitForAttr } from "../fixtures/scopeWait";
import { resolveExportDir, resolveProfileDir } from "../../../video-editor/adapters/node/desktopProfileConfig";
import { preflight, StartupError } from "./preflight";
import { type RealHost, startRealHost } from "./startRealHost";

// The real composition (worker + LevelDB + executors) without a window.
let host: RealHost | null = null;
const dirs: string[] = [];
const savedFfmpeg = process.env.MINICUT_FFMPEG_PATH;

afterEach(async () => {
	await host?.dispose();
	host = null;
	if (savedFfmpeg === undefined) delete process.env.MINICUT_FFMPEG_PATH;
	else process.env.MINICUT_FFMPEG_PATH = savedFfmpeg;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempProfile = () => {
	const dir = mkdtempSync(path.join(tmpdir(), "minicut-app-"));
	dirs.push(dir);
	return dir;
};

const start = (profileDir: string) =>
	startRealHost({
		profileDir,
		exportDir: resolveExportDir(profileDir),
		prompt: async () => null,
		onCrash: (error) => {
			throw error;
		},
	});

test("starts on a profile, serves a project and shuts down so the profile can be reopened", async () => {
	const profile = tempProfile();
	host = await start(profile);
	const first = host;
	expect(first.services.exportDirectory).toBe(path.join(profile, "exports"));
	expect(first.services.preview).toBeDefined();

	const root = await new Promise<NonNullable<ReturnType<typeof first.pageRuntime.getRootScope>>>((resolve) => {
		const check = () => {
			const scope = first.pageRuntime.getRootScope();
			if (scope) {
				stop();
				resolve(scope);
			}
		};
		const stop = first.pageRuntime.subscribeRootScope(check);
		check();
	});
	await waitForAttr(first.pageRuntime, root, "timelineZoom", (value) => typeof value === "number");

	await first.dispose();
	host = null;

	// The database lock was released by the clean shutdown.
	host = await start(profile);
});

test("a profile that is already open is a startup error, not an empty app", async () => {
	const profile = tempProfile();
	host = await start(profile);

	const error = await start(profile).then(
		() => null,
		(reason: unknown) => reason,
	);

	expect(error).toBeInstanceOf(StartupError);
	expect((error as StartupError).message).toContain("database");
});

test("missing ffmpeg is an explicit startup error with a hint", async () => {
	process.env.MINICUT_FFMPEG_PATH = path.join(tempProfile(), "no-such-ffmpeg");
	const error = await preflight(tempProfile()).then(
		() => null,
		(reason: unknown) => reason,
	);

	expect(error).toBeInstanceOf(StartupError);
	expect((error as StartupError).message).toContain("ffmpeg");
	expect((error as StartupError).hint).toContain("MINICUT_FFMPEG_PATH");
});

test("profile and export folders follow the environment, then per-user defaults", () => {
	expect(resolveProfileDir({ MINICUT_PROFILE_DIR: "rel" }, "win32", "H")).toBe(path.resolve("rel"));
	expect(resolveProfileDir({ APPDATA: "A" }, "win32", "H")).toBe(path.join("A", "MiniCut", "gpuix-profile"));
	expect(resolveProfileDir({}, "darwin", "H")).toBe(
		path.join("H", "Library", "Application Support", "MiniCut", "gpuix-profile"),
	);
	expect(resolveProfileDir({}, "linux", "H")).toBe(path.join("H", ".local", "share", "minicut", "gpuix-profile"));
	expect(resolveExportDir("P", {})).toBe(path.join("P", "exports"));
	expect(resolveExportDir("P", { MINICUT_EXPORT_DIR: "x" })).toBe(path.resolve("x"));
});
