import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetResolver } from "../../contracts/assets";
import type { FileArtifact } from "../../contracts/job";
import type { ProbeResult } from "../../contracts/probe";
import { MediaError } from "../mediaError";
import { MediaJobController } from "../mediaJob";
import type { MediaService } from "../mediaService";
import type {
	MediaRpcClientMessage,
	MediaRpcServerMessage,
} from "./mediaRpcProtocol";
import { createMediaServiceClient } from "./mediaServiceClient";
import { serveMediaService } from "./mediaServiceServer";
import { createNodePortEndpoint } from "./nodePortEndpoint";

const probeResult = { formatName: "fake", durationSeconds: 1 } as unknown as ProbeResult;

type Harness = {
	client: ReturnType<typeof createMediaServiceClient>;
	jobs: MediaJobController<FileArtifact>[];
	resolved: string[];
	closeServerSide(): void;
};

const open = (
	service: (resolver: AssetResolver, jobs: MediaJobController<FileArtifact>[]) => MediaService,
	assets: AssetResolver,
): Harness => {
	const channel = new MessageChannel();
	const jobs: MediaJobController<FileArtifact>[] = [];
	const resolved: string[] = [];
	serveMediaService({
		endpoint: createNodePortEndpoint<MediaRpcClientMessage, MediaRpcServerMessage>(channel.port2),
		createService: (resolver) => service(resolver, jobs),
		fingerprint: async (filePath) => ({ fingerprint: `fp:${filePath}`, version: "v" }),
	});
	const client = createMediaServiceClient({
		endpoint: createNodePortEndpoint<MediaRpcServerMessage, MediaRpcClientMessage>(channel.port1),
		assets: {
			resolve: async (assetId) => {
				resolved.push(assetId);
				return assets.resolve(assetId);
			},
		},
	});
	return {
		client,
		jobs,
		resolved,
		closeServerSide: () => channel.port2.close(),
	};
};

const unusedAssets: AssetResolver = {
	resolve: () => ({ ok: false, error: { code: "asset-not-found", message: "none" } }),
};

const fakeService = (
	resolver: AssetResolver,
	jobs: MediaJobController<FileArtifact>[],
): MediaService => {
	const newJob = (requestId: string) => {
		const job = new MediaJobController<FileArtifact>(requestId);
		jobs.push(job);
		return job;
	};
	return {
		probe: async (request) => {
			if ("assetId" in request.source) {
				const resolution = await resolver.resolve(request.source.assetId);
				if (!resolution.ok) {
					throw new MediaError(resolution.error.code, resolution.error.message);
				}
			}
			return probeResult;
		},
		exportPlan: (request) => newJob(request.requestId),
		generateProxy: (request) => newJob(request.requestId),
		capabilities: async () => {
			throw new MediaError("binary-not-found", "no ffmpeg");
		},
	};
};

describe("media service over a message channel", () => {
	const opened: Harness[] = [];
	afterEach(() => {
		for (const harness of opened.splice(0)) harness.client.dispose();
	});
	const start = (assets: AssetResolver = unusedAssets) => {
		const harness = open(fakeService, assets);
		opened.push(harness);
		return harness;
	};
	const nextJob = async (harness: Harness) => {
		await expect.poll(() => harness.jobs.length).toBeGreaterThan(0);
		return harness.jobs[harness.jobs.length - 1]!;
	};

	it("resolves asset ids through the client's registry", async () => {
		const harness = start({
			resolve: (assetId) => ({ ok: true, location: { path: `/media/${assetId}.mp4` } }),
		});
		await expect(
			harness.client.probe({ requestId: "p1", source: { assetId: "a-1" } }),
		).resolves.toEqual(probeResult);
		expect(harness.resolved).toEqual(["a-1"]);
	});

	it("returns typed errors from the service and from the registry", async () => {
		const harness = start();
		await expect(
			harness.client.probe({ requestId: "p2", source: { assetId: "missing" } }),
		).rejects.toMatchObject({ name: "MediaError", code: "asset-not-found" });
		await expect(harness.client.capabilities()).rejects.toMatchObject({
			code: "binary-not-found",
			message: "no ffmpeg",
		});
	});

	it("fingerprints a file in the service process", async () => {
		const harness = start();
		await expect(harness.client.fingerprint("/x.mp4")).resolves.toEqual({
			fingerprint: "fp:/x.mp4",
			version: "v",
		});
	});

	it("delivers job progress and the result as separate events", async () => {
		const harness = start();
		const job = harness.client.exportPlan({
			requestId: "e1",
			outputPath: "/out.webm",
		} as never);
		const events: string[] = [];
		job.onProgress((event) => events.push(`${event.stage}:${event.ratio}`));
		const remote = await nextJob(harness);
		remote.emitProgress({ stage: "rendering", ratio: 0.5 });
		remote.done({ path: "/out.webm", size: 3, durationSeconds: 1, frameCount: 25 });
		await expect(job.outcome).resolves.toEqual({
			status: "done",
			artifact: { path: "/out.webm", size: 3, durationSeconds: 1, frameCount: 25 },
		});
		expect(events).toEqual(["rendering:0.5"]);
	});

	it("forwards cancel to the running job", async () => {
		const harness = start();
		const job = harness.client.generateProxy({
			requestId: "x1",
			outputPath: "/proxy.mp4",
			source: { path: "/in.mp4" },
		});
		const remote = await nextJob(harness);
		remote.setCancelHandler(() => remote.cancelled());
		job.cancel();
		await expect(job.outcome).resolves.toEqual({ status: "cancelled" });
		expect(remote.cancelRequested).toBe(true);
	});

	it("fails calls and jobs in flight when the service goes away", async () => {
		const harness = start();
		const job = harness.client.exportPlan({ requestId: "e2", outputPath: "/o.webm" } as never);
		await nextJob(harness);
		harness.closeServerSide();
		await expect(job.outcome).resolves.toMatchObject({
			status: "error",
			error: { details: { reason: "service-stopped" } },
		});
		await expect(harness.client.probe({ requestId: "late", source: { path: "/a" } })).rejects.toMatchObject({
			details: { reason: "service-stopped" },
		});
	});
});
