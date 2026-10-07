import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobProgressEvent } from "../contracts/job";
import { createMediaService } from "./mediaService";
import {
	ensureFixtures,
	type FixtureName,
} from "./testing/mediaFixtures";
import { scenarioAssets, videoAudioScenario } from "./testing/exportScenarios";

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("media service export", () => {
	let fixtures: Record<FixtureName, string>;
	let outDir: string;

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr", "audio-tone"]);
		outDir = await mkdtemp(path.join(os.tmpdir(), "minicut-export-"));
	});
	afterAll(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	const request = (id: string, extra: Record<string, unknown> = {}) => ({
		requestId: id,
		plan: videoAudioScenario.plan,
		range: { type: "project" as const },
		outputPath: path.join(outDir, `${id}.webm`),
		assets: scenarioAssets(videoAudioScenario, fixtures),
		...extra,
	});

	it("exports a plan to WebM with monotonic progress and atomic output", async () => {
		const service = createMediaService();
		const job = service.exportPlan(request("ok"));
		const events: JobProgressEvent[] = [];
		job.onProgress((event) => events.push(event));
		const outcome = await job.outcome;

		expect(outcome.status).toBe("done");
		if (outcome.status !== "done") return;
		expect(outcome.artifact.path).toBe(path.join(outDir, "ok.webm"));
		expect(outcome.artifact.size).toBeGreaterThan(0);
		expect(outcome.artifact.frameCount).toBe(50);
		expect(outcome.artifact.durationSeconds).toBeCloseTo(2, 1);

		const ratios = events.map((e) => e.ratio);
		expect(ratios).toEqual([...ratios].sort((a, b) => a - b));
		expect(events[0]).toMatchObject({ stage: "queued" });
		expect(events.at(-1)).toMatchObject({ stage: "finalizing", ratio: 1 });
		expect(events.some((e) => e.stage === "rendering")).toBe(true);

		const leftovers = (await readdir(outDir)).filter((n) => n.includes(".part"));
		expect(leftovers).toEqual([]);
	});

	it("replays the terminal event to subscribers attached late", async () => {
		const service = createMediaService();
		const job = service.exportPlan(request("late"));
		await job.outcome;
		const seen: number[] = [];
		job.onDone((artifact) => seen.push(artifact.frameCount));
		expect(seen).toEqual([50]);
	});

	it("cancel kills the process tree and leaves no partial or final file", async () => {
		const pids: number[] = [];
		const service = createMediaService({
			onProcessStart: (pid) => pids.push(pid),
		});
		const longPlan = {
			...videoAudioScenario.plan,
			duration: 120,
			width: 1280,
			height: 720,
		};
		const job = service.exportPlan(
			request("cancel", { plan: longPlan, width: 1280, height: 720 }),
		);
		await new Promise<void>((resolve) => {
			job.onProgress((event) => {
				if (event.stage === "rendering" && event.ratio > 0) resolve();
			});
		});
		job.cancel();
		const outcome = await job.outcome;
		expect(outcome.status).toBe("cancelled");
		expect(pids).toHaveLength(1);
		expect(isAlive(pids[0])).toBe(false);
		const files = (await readdir(outDir)).filter((n) => n.startsWith(".cancel") || n === "cancel.webm");
		expect(files).toEqual([]);
	});

	it("cancel while queued never starts ffmpeg", async () => {
		const pids: number[] = [];
		const service = createMediaService({
			maxConcurrentJobs: 1,
			onProcessStart: (pid) => pids.push(pid),
		});
		const first = service.exportPlan(request("q1"));
		const second = service.exportPlan(request("q2"));
		second.cancel();
		expect((await second.outcome).status).toBe("cancelled");
		expect((await first.outcome).status).toBe("done");
		expect(pids).toHaveLength(1);
	});

	it("bounds concurrency: a queued job renders only after the first completes", async () => {
		const service = createMediaService({ maxConcurrentJobs: 1 });
		const order: string[] = [];
		const a = service.exportPlan(request("c1"));
		const b = service.exportPlan(request("c2"));
		a.onProgress((e) => e.stage === "rendering" && order.push("a-render"));
		b.onProgress((e) => e.stage === "rendering" && order.push("b-render"));
		a.onDone(() => order.push("a-done"));
		b.onDone(() => order.push("b-done"));
		await Promise.all([a.outcome, b.outcome]);
		expect(order.indexOf("b-render")).toBeGreaterThan(order.indexOf("a-done"));
	});

	it("surfaces ffmpeg failure as a typed error and cleans up", async () => {
		const bad = path.join(outDir, "not-media.mp4");
		await writeFile(bad, "this is not a video");
		const service = createMediaService();
		const job = service.exportPlan(
			request("fail", {
				assets: { "res-video": { path: bad }, "res-tone": { path: fixtures["audio-tone"] } },
			}),
		);
		const errors: string[] = [];
		job.onError((error) => errors.push(error.code));
		const outcome = await job.outcome;
		expect(outcome.status).toBe("error");
		if (outcome.status !== "error") return;
		expect(outcome.error.code).toBe("process-failed");
		expect(String(outcome.error.details?.stderr)).not.toBe("");
		expect(errors).toEqual(["process-failed"]);
		const files = (await readdir(outDir)).filter((n) => n.startsWith(".fail") || n === "fail.webm");
		expect(files).toEqual([]);
	});

	it("reports missing assets and unsupported operations as typed errors", async () => {
		const service = createMediaService();
		const missing = await service.exportPlan(
			request("missing", { assets: {} }),
		).outcome;
		expect(missing).toMatchObject({
			status: "error",
			error: { code: "asset-not-found" },
		});

		const unsupported = await service.exportPlan(
			request("unsupported", {
				plan: {
					...videoAudioScenario.plan,
					clipSources: [
						{ ...videoAudioScenario.plan.clipSources[0], fadeIn: 0.5 },
					],
				},
			}),
		).outcome;
		expect(unsupported).toMatchObject({
			status: "error",
			error: { code: "unsupported-operation" },
		});
	});

	it("rejects duplicate in-flight requestId and outputPath", async () => {
		const service = createMediaService();
		const first = service.exportPlan(request("dup"));
		const sameId = await service.exportPlan(
			request("dup", { outputPath: path.join(outDir, "dup-other.webm") }),
		).outcome;
		expect(sameId).toMatchObject({ status: "error", error: { code: "invalid-request" } });
		const sameOutput = await service.exportPlan(
			request("dup-b", { outputPath: path.join(outDir, "dup.webm") }),
		).outcome;
		expect(sameOutput).toMatchObject({ status: "error", error: { code: "invalid-request" } });
		expect((await first.outcome).status).toBe("done");
		// once finished the id and output are free again
		const again = await service.exportPlan(request("dup")).outcome;
		expect(again.status).toBe("done");
	});

	it("a throwing listener cannot break the job; onCancelled fires and replays", async () => {
		const service = createMediaService();
		const job = service.exportPlan(request("listener"));
		job.onProgress(() => {
			throw new Error("listener boom");
		});
		job.onDone(() => {
			throw new Error("listener boom");
		});
		expect((await job.outcome).status).toBe("done");

		const queued = createMediaService({ maxConcurrentJobs: 1 });
		const blocker = queued.exportPlan(request("blk"));
		const victim = queued.exportPlan(request("victim"));
		const events: string[] = [];
		victim.onCancelled(() => events.push("live"));
		victim.cancel();
		await victim.outcome;
		victim.onCancelled(() => events.push("late"));
		expect(events).toEqual(["live", "late"]);
		await blocker.outcome;
	});

	it("reports a missing ffmpeg binary as binary-not-found", async () => {
		const service = createMediaService({ ffmpegPath: "ffmpeg-does-not-exist" });
		const outcome = await service.exportPlan(request("nobin")).outcome;
		expect(outcome).toMatchObject({
			status: "error",
			error: { code: "binary-not-found" },
		});
	});
});
