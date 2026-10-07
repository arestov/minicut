import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "./cli";
import { ensureFixtures, type FixtureName } from "./testing/mediaFixtures";
import { scenarioAssets, videoAudioScenario } from "./testing/exportScenarios";

describe("media cli", () => {
	let fixtures: Record<FixtureName, string>;
	let dir: string;
	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr", "audio-tone"]);
		dir = await mkdtemp(path.join(os.tmpdir(), "minicut-cli-"));
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("probes a file", async () => {
		const { exitCode, result } = await runCli(["probe", fixtures["video-cfr"]]);
		expect(exitCode).toBe(0);
		expect(result).toMatchObject({ video: { width: 320, height: 240 } });
	});

	it("exports a plan JSON with embedded assets", async () => {
		const planPath = path.join(dir, "plan.json");
		await writeFile(
			planPath,
			JSON.stringify({
				plan: videoAudioScenario.plan,
				assets: scenarioAssets(videoAudioScenario, fixtures),
			}),
		);
		const out = path.join(dir, "out.webm");
		const { exitCode, result } = await runCli(["export", "--plan", planPath, "--out", out]);
		expect(exitCode).toBe(0);
		expect(result).toMatchObject({
			status: "done",
			artifact: { path: out, frameCount: 50 },
		});
	});

	it("returns exit code 1 with a typed error for bad input", async () => {
		const { exitCode, result } = await runCli(["probe", path.join(dir, "missing.mp4")]);
		expect(exitCode).toBe(1);
		expect(result).toMatchObject({ error: { code: "asset-not-found" } });
	});
});
