/**
 * Real-window smoke test of the GPUIX app on the real host. It opens windows
 * (serial, never parallel to other window tests) and is not part of `bun test`:
 *
 *   npm run test:gpuix:app-window
 *
 * Flow: open the app on a temp profile -> import a generated fixture through
 * the test hook (stands in for the native dialog) -> the clip lands on the
 * timeline -> the preview shows decoded pixels -> export to a file -> quit
 * cleanly -> start again on the same profile -> the project is restored.
 *
 * Do not print to stdout from here before `launch` resolves: stdout carries
 * the automation protocol.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "@gpuix/solid/automation";
import { gpuixFixture } from "../test/mediaFixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(here, "..");
const shots = path.resolve(here, "../../../../tmp/gpuix-screenshots");
fs.mkdirSync(shots, { recursive: true });

const watchdog = setTimeout(() => {
	console.error("[app-smoke] watchdog fired, exiting");
	process.exit(2);
}, 240_000);
watchdog.unref?.();

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "minicut-app-smoke-"));
const exportDir = path.join(profileDir, "exports-out");
const fixture = await gpuixFixture("video-audio");

type App = Awaited<ReturnType<typeof launch>>;

const start = (): Promise<App> =>
	launch({
		command: process.env.BUN_BIN || "bun",
		args: ["app/main.tsx"],
		cwd,
		env: {
			...process.env,
			GPUIX_BACKGROUND: process.env.GPUIX_BACKGROUND ?? "1",
			MINICUT_PROFILE_DIR: profileDir,
			MINICUT_EXPORT_DIR: exportDir,
			MINICUT_GPUIX_TEST_HOOKS: "1",
			...(process.env.MINICUT_LOG_FILE ? { MINICUT_LOG_FILE: process.env.MINICUT_LOG_FILE } : {}),
			MINICUT_TEST_IMPORT_PATHS: fixture,
		},
	});

// Bounded poll over automation queries (counts, screenshot luma): the automation
// API has no wait primitive for these conditions. Fails with `message` at the deadline.
const eventually = async (
	condition: () => Promise<boolean>,
	message: string,
	timeoutMs = 10_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (!(await condition())) {
		if (Date.now() > deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

let failures = 0;
const check = async (name: string, fn: () => Promise<void>) => {
	try {
		await fn();
		console.error(`  ok   ${name}`);
	} catch (error) {
		failures += 1;
		await app?.screenshot({ path: path.join(shots, `app-fail-${failures}.png`) }).catch(() => undefined);
		console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
	}
};

/** Mean luma of a region of a screenshot (0-255), measured with ffmpeg. */
const regionLuma = (png: string, region: { x: number; y: number; width: number; height: number }) => {
	const result = spawnSync(
		"ffmpeg",
		[
			"-v", "error", "-i", png,
			"-vf", `crop=${region.width}:${region.height}:${region.x}:${region.y},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
			"-f", "null", "-",
		],
		{ encoding: "utf8" },
	);
	const text = `${result.stdout}${result.stderr}`;
	const match = /YAVG=([0-9.]+)/.exec(text);
	if (!match) throw new Error(`could not measure ${png}: ${text.slice(0, 300)}`);
	return Number(match[1]);
};

const previewLuma = async (app: App, name: string): Promise<number> => {
	const png = path.join(shots, name);
	await app.screenshot({ path: png });
	const size = spawnSync(
		"ffprobe",
		["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", png],
		{ encoding: "utf8" },
	);
	const bounds = await app.getByTestId("preview-frame").bounds();
	const windowWidth = 1280;
	const scale = Number(size.stdout.trim()) / windowWidth || 1;
	const inset = 8;
	return regionLuma(png, {
		x: Math.round((bounds.x + inset) * scale),
		y: Math.round((bounds.y + inset) * scale),
		width: Math.max(2, Math.round((bounds.width - 2 * inset) * scale)),
		height: Math.max(2, Math.round((bounds.height - 2 * inset) * scale)),
	});
};

let app: App | null = null;
try {
	app = await start();
	await app.getByTestId("app-shell").waitFor({ timeoutMs: 60_000 });

	await check("opens an empty workspace with a default project", async () => {
		await app!.getByTestId("project-title").waitFor({ timeoutMs: 20_000 });
	});

	await check("test import brings the fixture in through the real import path", async () => {
		await app!.getByTestId("test-import").click();
		await eventually(
			async () => (await app!.getByTestId("resource-row").count()) === 1,
			"the resource is not listed",
			30_000,
		);
		await eventually(
			async () => (await app!.getByTestId("resource-note").count()) === 0,
			"resource still shows a note",
		);
	});

	await check("the imported clip is on the timeline", async () => {
		await eventually(
			async () => (await app!.getByTestId("timeline").count()) > 0 && (await app!.getByText("video-audio").count()) >= 2,
			"no clip on the timeline",
			30_000,
		);
	});

	await check("the preview shows a decoded frame of the clip", async () => {
		await eventually(async () => (await previewLuma(app!, "app-preview-1.png")) > 25, "preview stayed black", 30_000);
	});

	await check("export writes a WebM file", async () => {
		await app!.getByTestId("export-project").click();
		await app!.getByTestId("export-progress-file").waitFor({ timeoutMs: 120_000 });
		const files = fs.readdirSync(exportDir).filter((name) => name.endsWith(".webm"));
		if (files.length !== 1) throw new Error(`expected one export, found ${files.join(", ") || "none"}`);
		if (fs.statSync(path.join(exportDir, files[0])).size < 1000) throw new Error("export file is empty");
	});

	 await check("selected Clip export saves a second distinct file with matching inspector metadata", async () => {
  const prior = fs.readdirSync(exportDir).filter(name => name.endsWith(".webm"));
  if (prior.length !== 1) throw new Error("project export must precede selected Clip export");
  const clips = (await app!.getByTestId("clip").all()).filter(node => String(node.customProps?.["aria-label"] ?? "").includes("video-audio"));
  if (clips.length !== 1 || !clips[0].bounds) throw new Error("imported video Clip is missing or ambiguous");
  const bounds = clips[0].bounds;
  await app!.mouse.click({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  await app!.getByTestId("inspector-name").waitFor(); await app!.getByTestId("inspector-tabs-export").click(); await app!.getByTestId("inspector-export-queue").click();
  await eventually(async () => (await app!.getByType("text").all()).some(node => node.text?.startsWith("Saved file: ")), "selected Clip did not report a saved file", 120_000);
  const text = (await app!.getByType("text").all()).map(node => node.text ?? "");
  const saved = text.find(value => value.startsWith("Saved file: "))?.slice("Saved file: ".length);
  if (!saved || saved === prior[0]) throw new Error("selected Clip did not receive a distinct saved filename");
  if (!text.includes(`Export folder: ${exportDir}`)) throw new Error("inspector export folder differs from the configured host directory");
  const files = fs.readdirSync(exportDir).filter(name => name.endsWith(".webm"));
  if (files.length !== 2 || new Set(files).size !== 2 || !files.includes(saved) || !files.includes(prior[0])) throw new Error(`expected project and Clip files, found ${files.join(", ")}`);
  for (const file of files) if (fs.statSync(path.join(exportDir, file)).size <= 0) throw new Error(`empty export ${file}`);
  await app!.screenshot({ path: path.join(shots, "app-inspector-export.png") });
 });
 await app.screenshot({ path: path.join(shots, "app-before-quit.png") });
	await app.getByTestId("test-quit").click();
	app = null;

	// Start again on the same profile; the previous process may still be closing
	// LevelDB, in which case the new one reports a startup error and we retry.
	let second: App | null = null;
	await eventually(
		async () => {
			second?.close().catch(() => undefined);
			second = await start();
			await Promise.race([
				second.getByTestId("app-shell").waitFor({ timeoutMs: 20_000 }),
				second.getByTestId("startup-error").waitFor({ timeoutMs: 20_000 }),
			]).catch(() => undefined);
			return (await second.getByTestId("app-shell").count()) > 0;
		},
		"the app did not restart on the same profile",
		60_000,
	);
	app = second;

	await check("restart restores the project, its resource and the clip", async () => {
		await eventually(
			async () => (await app!.getByTestId("resource-row").count()) === 1,
			"the resource is not listed after restart",
			30_000,
		);
		await eventually(
			async () => (await app!.getByText("video-audio").count()) >= 2,
			"clip is not back on the timeline",
			30_000,
		);
	});

	await check("the restored resource is available again and the preview decodes", async () => {
		await eventually(
			async () => (await app!.getByText("File missing").count()) === 0,
			"resource reported as missing",
		);
		await eventually(async () => (await previewLuma(app!, "app-preview-restored.png")) > 25, "preview stayed black", 30_000);
	});

	await app!.screenshot({ path: path.join(shots, "app-restored.png") });
	console.error(`[app-smoke] done, ${failures} failure(s)`);
} finally {
	await app?.close().catch(() => undefined);
}

try {
	// The killed app may still hold the files for a moment; the temp folder is disposable.
	fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
} catch {
	// left for the OS temp cleanup
}
process.exit(failures === 0 ? 0 : 1);
