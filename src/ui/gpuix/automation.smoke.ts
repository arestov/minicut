/**
 * Real-window smoke test of the GPUIX app on the timeline fixture. It opens a
 * window, so it runs serially and never as part of `bun test`:
 *
 *   npm run test:gpuix:window
 *
 * Do not print to stdout from the app or from here before `launch` resolves:
 * stdout carries the automation protocol.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "@gpuix/solid/automation";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(here, "../../../tmp/gpuix-screenshots");
fs.mkdirSync(shots, { recursive: true });

const watchdog = setTimeout(() => {
	console.error("[window-smoke] watchdog fired, exiting");
	process.exit(2);
}, 120_000);
watchdog.unref?.();

const app = await launch({
	command: process.env.BUN_BIN || "bun",
	args: ["main.tsx", "--scenario=timeline"],
	cwd: here,
	env: { ...process.env, GPUIX_BACKGROUND: process.env.GPUIX_BACKGROUND ?? "1" },
});

/** Polls a condition with a pause between reads; fails with `message` after the timeout. */
const eventually = async (
	condition: () => Promise<boolean>,
	message: string,
	timeoutMs = 5_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (!(await condition())) {
		if (Date.now() > deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

const revealInspectorTarget = async (tab: "edit" | "color", testId: string) => {
 const panel = app.getByTestId(`inspector-panel-${tab}`);
 const target = app.getByTestId(testId);
 const panelNode = await panel.element();
 await app.call("scrollTo", { elementId: panelNode.id, x: 0, y: 0 });
 const initial = await target.bounds(); const bounds = await panel.bounds();
 await app.call("scrollTo", { elementId: panelNode.id, x: 0, y: -Math.max(0, initial.y - bounds.y - 20) });
 await eventually(async () => {
  const current = await target.bounds(); const viewport = await panel.bounds();
  const x = current.x + current.width / 2; const y = current.y + current.height / 2;
  return current.width > 0 && current.height > 0 && x >= viewport.x && x <= viewport.x + viewport.width && y >= viewport.y && y <= viewport.y + viewport.height;
 }, `inspector target ${testId} did not become visible within ${tab} panel`);
 return target;
};

const onlyInspectorPanel = async (tab: "edit" | "color" | "audio" | "export") => {
 await app.getByTestId(`inspector-panel-${tab}`).waitFor();
 const panels = (await app.getByType("div").all()).filter(node => node.testId?.startsWith("inspector-panel-"));
 if (panels.length !== 1 || panels[0].testId !== `inspector-panel-${tab}`) throw new Error(`inactive inspector content remained mounted at ${tab}`);
};
let failures = 0;
const check = async (name: string, fn: () => Promise<void>) => {
	try {
		await fn();
		console.error(`  ok   ${name}`);
	} catch (error) {
		failures += 1;
		console.error(
			`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

try {
	// The fixture is seeded before the window opens; the timeline fills in as
	// sync updates arrive.
	await app.getByTestId("timeline").waitFor({ timeoutMs: 60_000 });
	await app.getByText("Interview A").waitFor({ timeoutMs: 30_000 });
	await app.screenshot({ path: path.join(shots, "timeline-initial.png") });

	await check("sidebar lists the scenario resources", async () => {
		await app.getByText("Interview.mp4").waitFor({ timeoutMs: 5_000 });
		await app.getByText("Music.wav").waitFor({ timeoutMs: 5_000 });
	});

	await check("zoom in changes the zoom readout through the model", async () => {
		const before = await app.getByTestId("zoom-value").textContent();
		const zoom = Number.parseInt(before, 10);
		if (!Number.isFinite(zoom)) throw new Error(`unexpected zoom readout "${before}"`);
		await app.getByTestId("zoom-in").click();
		// The model clamps and steps the zoom; any larger value proves the round trip.
		await eventually(async () => {
			const after = Number.parseInt(await app.getByTestId("zoom-value").textContent(), 10);
			return after > zoom;
		}, `zoom stayed at "${before}"`);
	});

	await check("dragging a clip moves it later in time", async () => {
		const clip = app.getByText("Intro");
		const before = await clip.bounds();
		await clip.dragBy(80, 0);
		await eventually(
			async () => (await app.getByText("Intro").bounds()).x > before.x + 20,
			"the clip did not move",
		);
	});

	 await check("inspector edits canonical Clip name, trim and opacity", async () => {
  await app.getByText("Intro").click(); await app.getByTestId("inspector-name").waitFor();
  await app.getByTestId("inspector-name").fill("Intro renamed"); await app.getByTestId("inspector-name").press("enter"); await app.getByText("Intro renamed").waitFor();
  await app.getByTestId("inspector-tabs-edit").click(); await onlyInspectorPanel("edit");
  const before = await app.getByTestId("inspector-trim-end-value").textContent();
  await (await revealInspectorTarget("edit", "inspector-trim-end-dec")).click();
  await eventually(async () => (await app.getByTestId("inspector-trim-end-value").textContent()) !== before, "duration did not change");
  await (await revealInspectorTarget("edit", "inspector-trim-end-inc")).click();
  await eventually(async () => (await app.getByTestId("inspector-trim-end-value").textContent()) === before, "duration did not restore");
  await (await revealInspectorTarget("edit", "inspector-opacity")).press("home"); await app.getByText("Opacity 0%").waitFor();
  await (await revealInspectorTarget("edit", "inspector-opacity")).press("end"); await app.getByText("Opacity 100%").waitFor();
  await app.screenshot({ path: path.join(shots, "inspector-edit.png") });
 });

 await check("Color persists label and Before restores on release and automation blur", async () => {
  await app.getByTestId("inspector-tabs-color").click(); await onlyInspectorPanel("color"); await (await revealInspectorTarget("color", "inspector-label-color-16a34a")).click();
  await revealInspectorTarget("color", "inspector-label-color");
  await eventually(async () => (await app.call("getPaintedText", {})).text.includes("#16a34a"), "label color did not echo");
  await app.screenshot({ path: path.join(shots, "inspector-label-color.png") });
  await app.getByTestId("inspector-tabs-edit").click(); await app.getByTestId("inspector-tabs-color").click();
  await revealInspectorTarget("color", "inspector-label-color");
  await eventually(async () => (await app.call("getPaintedText", {})).text.includes("#16a34a"), "label color did not persist");
  await app.screenshot({ path: path.join(shots, "inspector-label-color-remount.png") });
  await app.getByTestId("inspector-correction-add").click();
  await eventually(async () => (await app.getByType("div").all()).filter(node => node.testId?.startsWith("inspector-before-")).length === 1, "expected one Before target");
  const targets = (await app.getByType("div").all()).filter(node => node.testId?.startsWith("inspector-before-"));
  if (targets.length !== 1 || !targets[0].testId) throw new Error("Before target is ambiguous");
  const before = app.getByTestId(targets[0].testId);
  const panel = app.getByTestId("inspector-panel-color");
  const hold = async () => {
   const panelNode = await panel.element(); await app.call("scrollTo", { elementId: panelNode.id, x: 0, y: 0 });
   const initial = await before.bounds(); const bounds = await panel.bounds();
   await app.call("scrollTo", { elementId: panelNode.id, x: 0, y: -Math.max(0, initial.y - bounds.y - 20) });
   const point = await before.center(); await app.mouse.down(point); await app.getByText("Before held").waitFor(); return point;
  };
  let point = await hold(); await app.mouse.up(point); await app.getByText("Enabled").waitFor(); await app.getByText("Press and hold: Before").waitFor();
  point = await hold(); await app.call("blur", {}); await app.mouse.up(point); await app.getByText("Enabled").waitFor(); await app.getByText("Press and hold: Before").waitFor();
  await app.screenshot({ path: path.join(shots, "inspector-color.png") });
 });

 await check("Audio gain echoes canonical bounds and video selection is unavailable", async () => {
  await app.getByText("Music bed").click(); await app.getByTestId("inspector-tabs-audio").click(); await onlyInspectorPanel("audio");
  await app.getByTestId("inspector-audio-gain").press("home"); await app.getByText("Gain 0%").waitFor();
  await app.getByTestId("inspector-audio-gain").press("end"); await app.getByText("Gain 150%").waitFor();
  const rail = await app.getByTestId("inspector-audio-gain").bounds();
  await app.mouse.click({ x: rail.x + 5 + (rail.width - 10) * (100 / 150), y: rail.y + rail.height / 2 }); await app.getByText("Gain 100%").waitFor();
  await app.getByText("Intro renamed").click(); await app.getByText("Select an audio clip to edit playback settings.").waitFor(); await app.getByTestId("inspector-tabs-edit").click();
 });

 await check("Export fixture shows fixed settings without a false saved file", async () => {
  await app.getByTestId("inspector-tabs-export").click();
  for (const text of ["Range Clip", "Format WebM", "Quality High", "Queue clip export"]) await app.getByText(text).waitFor();
  await onlyInspectorPanel("export");
  const text = await app.getByType("text").all();
  if (text.some(node => node.text?.startsWith("Saved file:") || node.text?.startsWith("Export folder:"))) throw new Error("fixture implied a saved host file");
  await app.screenshot({ path: path.join(shots, "inspector-export.png") });
 });
 await app.screenshot({ path: path.join(shots, "timeline-final.png") });
	console.error(`[window-smoke] done, ${failures} failure(s)`);
} finally {
	await app.close();
}

process.exit(failures === 0 ? 0 : 1);
