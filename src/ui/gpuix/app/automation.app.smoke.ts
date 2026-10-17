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
import { launch, type ElementBounds, type TreeNode as PublicTreeNode } from "@gpuix/solid/automation";
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

	await check("timeline commands split, nudge, delete and add tracks", async () => {
		let phase = "initial clip count";
		try {
			const texts = (node: PublicTreeNode): string[] => [...(typeof node.text === "string" ? [node.text] : []), ...(node.children ?? []).flatMap(texts)];
			const namesImportedVideo = (node: PublicTreeNode): boolean => (node.type === "text" && !!node.text?.includes("video-audio")) || (node.children ?? []).some(namesImportedVideo);
			const namedVideos = async () => (await app!.getByTestId("clip").all()).filter(namesImportedVideo);
			const boundsOf = async (id: number) => (await app!.call("getBounds", { elementId: id })).bounds;
			const finite = (bounds: ElementBounds | null | undefined): bounds is ElementBounds => !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
			const outer = (bounds: ElementBounds, border: number): ElementBounds => ({ x: bounds.x - border, y: bounds.y - border, width: bounds.width + 2 * border, height: bounds.height + 2 * border });
			const inside = (bounds: ElementBounds, ruler: ElementBounds) => bounds.x >= ruler.x - 2 && bounds.x + bounds.width <= ruler.x + ruler.width + 2;
			const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
			const sameBounds = (a: ElementBounds, b: ElementBounds) => close(a.x, b.x, 1.5) && close(a.y, b.y, 1.5) && close(a.width, b.width, 1.5) && close(a.height, b.height, 1.5);
			phase = "initial clip count";
			const total = await app!.getByTestId("clip").count();
			phase = "named nodes";
			const initial = await namedVideos();
			if (initial.length !== 1) throw new Error("imported video Clip must be unique before timeline commands");
			const originalId = initial[0].id;
			phase = "initial bounds";
			const initialBounds = await boundsOf(originalId);
			phase = "ruler bounds";
			let ruler = await app!.getByTestId("timeline-ruler").bounds();
			if (!finite(initialBounds) || initialBounds.width <= 10 || !inside(initialBounds, ruler)) throw new Error("imported video Clip is not fully inside the ruler viewport");
			phase = "zoom text";
			const zoomText = await app!.getByTestId("zoom-value").textContent();
			const zoom = Number(/([0-9.]+)\s+px\/s/.exec(zoomText)?.[1]);
			if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("timeline zoom is not a finite positive px/s value");
			phase = "select original";
			await app!.mouse.click({ x: initialBounds.x + initialBounds.width / 2, y: initialBounds.y + initialBounds.height / 2 });
			phase = "command target";
			await eventually(async () => (await app!.getByTestId("timeline-command-target").textContent()).includes("video-audio"), "timeline command target did not select imported video");
			phase = "baseline bounds";
			let baseline: ElementBounds | null = null;
			await eventually(async () => {
				const raw = await boundsOf(originalId);
				if (!finite(raw)) return false;
				baseline = outer(raw, 2);
				return true;
			}, "selected imported video bounds did not arrive");
			const selectedOriginal = baseline!;
			phase = "ruler bounds";
			ruler = await app!.getByTestId("timeline-ruler").bounds();
			phase = "ruler seek";
			await app!.mouse.click({ x: selectedOriginal.x + selectedOriginal.width / 2, y: ruler.y + ruler.height / 2 });
			phase = "cursor";
			await eventually(async () => (await app!.getByTestId("status-cursor").textContent()) !== "00:00.00", "genuine ruler seek did not deliver a nonzero cursor");
			phase = "split click";
			await app!.getByTestId("timeline-split").click();
			type Pair = { rightId: number; leftRaw: ElementBounds; rightRaw: ElementBounds; left: ElementBounds; right: ElementBounds };
			phase = "split paint";
			let splitSnapshot: Pair | null = null;
			await eventually(async () => {
				const nodes = await namedVideos();
				if (nodes.length !== 2 || (await app!.getByTestId("clip").count()) !== total + 1 || !nodes.some(node => node.id === originalId)) return false;
				const rightId = nodes.find(node => node.id !== originalId)!.id;
				const leftRaw = await boundsOf(originalId), rightRaw = await boundsOf(rightId);
				if (!finite(leftRaw) || !finite(rightRaw)) return false;
				const left = outer(leftRaw, 2), right = outer(rightRaw, 1);
				if (!close(left.width, selectedOriginal.width / 2, 2) || !close(right.width, selectedOriginal.width / 2, 2) || !close(left.width + right.width, selectedOriginal.width, 2) || !close(left.x, selectedOriginal.x, 2) || !close(right.x, left.x + left.width, 2) || !close(left.y, right.y, 1) || !inside(left, ruler) || !inside(right, ruler)) return false;
				splitSnapshot = { rightId, leftRaw, rightRaw, left, right };
				return true;
			}, "split video identities and complete painted geometry did not arrive");
			const split = splitSnapshot!;
			phase = "right select";
			await app!.mouse.click({ x: split.rightRaw.x + split.rightRaw.width / 2, y: split.rightRaw.y + split.rightRaw.height / 2 });
			phase = "command target";
			await eventually(async () => (await app!.getByTestId("timeline-command-target").textContent()).includes("video-audio"), "right video command target did not arrive");
			phase = "right paint";
			let selectedRightSnapshot: Pair | null = null;
			await eventually(async () => {
				const nodes = await namedVideos();
				if (nodes.length !== 2 || !nodes.some(node => node.id === originalId) || !nodes.some(node => node.id === split.rightId)) return false;
				const leftRaw = await boundsOf(originalId), rightRaw = await boundsOf(split.rightId);
				if (!finite(leftRaw) || !finite(rightRaw)) return false;
				const left = outer(leftRaw, 1), right = outer(rightRaw, 2);
				if (!sameBounds(left, split.left) || !sameBounds(right, split.right)) return false;
				selectedRightSnapshot = { rightId: split.rightId, leftRaw, rightRaw, left, right };
				return true;
			}, "right selection border-normalized geometry did not arrive");
			const selectedRight = selectedRightSnapshot!;
			phase = "nudge click";
			await app!.getByTestId("timeline-nudge-forward").click();
			phase = "nudge paint";
			let nudgedSnapshot: Pair | null = null;
			await eventually(async () => {
				const nodes = await namedVideos();
				if (nodes.length !== 2 || !nodes.some(node => node.id === originalId) || !nodes.some(node => node.id === split.rightId)) return false;
				const leftRaw = await boundsOf(originalId), rightRaw = await boundsOf(split.rightId);
				if (!finite(leftRaw) || !finite(rightRaw)) return false;
				const left = outer(leftRaw, 1), right = outer(rightRaw, 2);
				if (!sameBounds(left, selectedRight.left) || !close(right.x - selectedRight.right.x, 0.5 * zoom, 1.5) || !close(right.y, selectedRight.right.y, 1.5) || !close(right.width, selectedRight.right.width, 1.5) || !close(right.height, selectedRight.right.height, 1.5)) return false;
				nudgedSnapshot = { rightId: split.rightId, leftRaw, rightRaw, left, right };
				return true;
			}, "nudge did not move only the right video by half a second");
			if (!nudgedSnapshot) throw new Error("nudge snapshot missing");
			phase = "delete/readback";
			await app!.getByTestId("timeline-delete").click();
			await eventually(async () => {
				const nodes = await namedVideos();
				return nodes.length === 1 && nodes[0].id === originalId && (await app!.getByTestId("clip").count()) === total;
			}, "delete did not remove only the right video");
			phase = "inspector";
			await app!.getByTestId("inspector-empty").waitFor();
			if (!(await app!.getByTestId("inspector-empty").textContent()).includes("No clip selected")) throw new Error("Inspector did not clear after Delete");
			phase = "ruler bounds";
			ruler = await app!.getByTestId("timeline-ruler").bounds();
			phase = "surviving bounds";
			let survivingSnapshot: ElementBounds | null = null;
			await eventually(async () => {
				const raw = await boundsOf(originalId);
				if (!finite(raw) || !finite(ruler)) return false;
				const surviving = outer(raw, 1);
				if (!finite(surviving) || surviving.x < ruler.x || surviving.x + surviving.width > ruler.x + ruler.width) return false;
				survivingSnapshot = surviving;
				return true;
			}, "surviving video bounds did not arrive inside the ruler");
			const surviving = survivingSnapshot!;
			const centerX = surviving.x + surviving.width / 2;
			const expectedTime = (centerX - ruler.x) / zoom;
			const remainingDuration = surviving.width / zoom;
			if (!Number.isFinite(expectedTime) || !Number.isFinite(remainingDuration) || expectedTime <= 0 || expectedTime >= remainingDuration) throw new Error("surviving video seek target is not finite and interior");
			phase = "interior ruler seek";
			await app!.mouse.click({ x: centerX, y: ruler.y + ruler.height / 2 });
			phase = "interior cursor";
			let latestStatus = "";
			try {
				await eventually(async () => {
					latestStatus = await app!.getByTestId("status-cursor").textContent();
					const match = /^(\d{2,}):([0-5]\d)\.(\d{2})$/.exec(latestStatus);
					if (!match) return false;
					const actualTime = Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 100;
					return Number.isFinite(actualTime) && actualTime > 0 && actualTime < remainingDuration && close(actualTime, expectedTime, Math.max(0.03, 1 / zoom));
				}, "ruler did not seek inside the surviving video before exports");
			} catch (error) {
				throw new Error(`${error instanceof Error ? error.message : String(error)}; latest status-cursor: ${latestStatus}`, { cause: error });
			}
			phase = "tracks";
			const tracksBefore = await app!.getByTestId("track-row").all();
			if (tracksBefore.length < 2) throw new Error("expected existing video/audio tracks");
			phase = "add video";
			await app!.getByTestId("timeline-add-video-track").click();
			phase = "video count";
			await eventually(async () => (await app!.getByTestId("track-row").count()) === tracksBefore.length + 1, "video track did not append");
			phase = "add audio";
			await app!.getByTestId("timeline-add-audio-track").click();
			phase = "audio count";
			await eventually(async () => (await app!.getByTestId("track-row").count()) === tracksBefore.length + 2, "audio track did not append");
			phase = "track kind";
			const tracksAfter = await app!.getByTestId("track-row").all();
			if (!tracksBefore.every((node, index) => tracksAfter[index].id === node.id)) throw new Error("existing track order changed");
			const headerOf = (node: PublicTreeNode): PublicTreeNode | undefined => node.testId === "track-header" ? node : (node.children ?? []).map(headerOf).find(header => header !== undefined);
			for (const [index, kind] of [[tracksBefore.length, "video"], [tracksBefore.length + 1, "audio"]] as const) {
				const header = headerOf(tracksAfter[index]);
				if (!header || !texts(header).includes(kind)) throw new Error(`appended track ${index} does not show ${kind}`);
			}
			phase = "screenshot";
			await app!.screenshot({ path: path.join(shots, "app-timeline-commands.png") });
		} catch (error) {
			throw new Error(`timeline command phase ${phase}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
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
  const clipNodes = await app!.getByTestId("clip").all();
  const namesImportedClip = (node: (typeof clipNodes)[number]): boolean => (node.type === "text" && !!node.text?.includes("video-audio")) || (node.children ?? []).some(namesImportedClip);
  const clips = clipNodes.filter(namesImportedClip);
  if (clips.length !== 1 || !clips[0].bounds) throw new Error("imported video Clip is missing or ambiguous");
  const bounds = clips[0].bounds;
  await app!.mouse.click({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  await app!.getByTestId("inspector-name").waitFor();
  await app!.getByTestId("inspector-tabs-export").click();
  await app!.getByTestId("inspector-panel-export").waitFor();
  await app!.getByTestId("inspector-export-queue").waitFor();
  await app!.getByTestId("inspector-export-queue").click();
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
