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
	env: { ...process.env, GPUIX_BACKGROUND: "1" },
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

	await app.screenshot({ path: path.join(shots, "timeline-final.png") });
	console.error(`[window-smoke] done, ${failures} failure(s)`);
} finally {
	await app.close();
}

process.exit(failures === 0 ? 0 : 1);
