import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fingerprintNodeFile } from "../../../adapters/node/nodeFileFingerprint";
import type { AssetResolver } from "../../contracts/assets";
import { createMediaService } from "../mediaService";
import { scenarioAssets, videoAudioScenario } from "../testing/exportScenarios";
import { ensureFixtures, type FixtureName } from "../testing/mediaFixtures";
import type {
	MediaRpcClientMessage,
	MediaRpcServerMessage,
} from "./mediaRpcProtocol";
import { createMediaServiceClient } from "./mediaServiceClient";
import { serveMediaService } from "./mediaServiceServer";
import { createNodePortEndpoint } from "./nodePortEndpoint";

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

// Real ffmpeg behind the message channel: the same wire the Electron utility
// process uses, without Electron.
describe("media service over a message channel with real ffmpeg", () => {
	let fixtures: Record<FixtureName, string>;
	let outDir: string;
	const pids: number[] = [];

	beforeAll(async () => {
		fixtures = await ensureFixtures(["video-cfr", "audio-tone"]);
		outDir = await mkdtemp(path.join(os.tmpdir(), "minicut-rpc-"));
	});
	afterAll(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	const open = () => {
		const channel = new MessageChannel();
		const registry: AssetResolver = {
			resolve: (assetId) =>
				assetId === "asset-cfr"
					? { ok: true, location: { path: fixtures["video-cfr"] } }
					: { ok: false, error: { code: "asset-not-found", message: assetId } },
		};
		const server = serveMediaService({
			endpoint: createNodePortEndpoint<MediaRpcClientMessage, MediaRpcServerMessage>(channel.port2),
			createService: (assetResolver) =>
				createMediaService({
					assetResolver,
					onProcessStart: (pid) => pids.push(pid),
				}),
			fingerprint: (filePath) => fingerprintNodeFile(filePath),
		});
		const client = createMediaServiceClient({
			endpoint: createNodePortEndpoint<MediaRpcServerMessage, MediaRpcClientMessage>(channel.port1),
			assets: registry,
		});
		return {
			client,
			close: () => {
				client.dispose();
				server.dispose();
				channel.port1.close();
				channel.port2.close();
			},
		};
	};

	it("probes by asset id and exports a plan with progress", async () => {
		const { client, close } = open();
		try {
			const info = await client.probe({ requestId: "probe", source: { assetId: "asset-cfr" } });
			expect(info.video?.width).toBeGreaterThan(0);

			const job = client.exportPlan({
				requestId: "rpc-export",
				plan: videoAudioScenario.plan,
				range: { type: "project" },
				outputPath: path.join(outDir, "rpc-export.webm"),
				assets: scenarioAssets(videoAudioScenario, fixtures),
			});
			const stages = new Set<string>();
			job.onProgress((event) => stages.add(event.stage));
			const outcome = await job.outcome;
			expect(outcome.status).toBe("done");
			expect(stages.has("rendering")).toBe(true);
			if (outcome.status === "done") expect(outcome.artifact.frameCount).toBe(50);
		} finally {
			close();
		}
	});

	it("cancel through the channel kills ffmpeg and leaves no file", async () => {
		const { client, close } = open();
		pids.length = 0;
		try {
			const job = client.exportPlan({
				requestId: "rpc-cancel",
				plan: { ...videoAudioScenario.plan, duration: 120, width: 1280, height: 720 },
				range: { type: "project" },
				outputPath: path.join(outDir, "rpc-cancel.webm"),
				assets: scenarioAssets(videoAudioScenario, fixtures),
				width: 1280,
				height: 720,
			});
			await new Promise<void>((resolve) => {
				job.onProgress((event) => {
					if (event.stage === "rendering" && event.ratio > 0) resolve();
				});
			});
			job.cancel();
			expect((await job.outcome).status).toBe("cancelled");
			expect(pids).toHaveLength(1);
			expect(isAlive(pids[0]!)).toBe(false);
			const files = (await readdir(outDir)).filter(
				(name) => name.startsWith(".rpc-cancel") || name === "rpc-cancel.webm",
			);
			expect(files).toEqual([]);
		} finally {
			close();
		}
	});
});
