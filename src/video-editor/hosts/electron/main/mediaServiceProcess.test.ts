import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetResolver } from "../../../media/contracts/assets";
import type { FileArtifact } from "../../../media/contracts/job";
import { MediaJobController } from "../../../media/node/mediaJob";
import type { MediaService } from "../../../media/node/mediaService";
import type {
	MediaRpcClientMessage,
	MediaRpcServerMessage,
} from "../../../media/node/rpc/mediaRpcProtocol";
import { runMediaServiceProcess } from "../../../media/node/rpc/runMediaServiceProcess";
import { serveMediaService } from "../../../media/node/rpc/mediaServiceServer";
import {
	MediaServiceStartError,
	startMediaServiceProcess,
	type UtilityProcessApi,
	type UtilityProcessLike,
} from "./mediaServiceProcess";

const noAssets: AssetResolver = {
	resolve: () => ({ ok: false, error: { code: "asset-not-found", message: "none" } }),
};

/** Utility process look-alike: the service side runs in this process over an event emitter pair. */
const createFakeUtility = (
	serve: (endpoint: {
		post(message: MiniCutServerMessage): void;
		onMessage(listener: (message: MiniCutClientMessage) => void): () => void;
		onClose(listener: () => void): () => void;
	}) => void | Promise<void>,
) => {
	const toChild = new EventEmitter();
	const child = new EventEmitter();
	const state = { killed: 0, exited: false };
	const exit = (code: number) => {
		if (state.exited) return;
		state.exited = true;
		child.emit("exit", code);
	};
	const fake: UtilityProcessLike = {
		postMessage: (message) => toChild.emit("message", message),
		on: ((event: string, listener: (...args: never[]) => void) => {
			child.on(event, listener as (...args: unknown[]) => void);
		}) as UtilityProcessLike["on"],
		kill: () => {
			state.killed += 1;
			// Real process exit is asynchronous.
			setImmediate(() => exit(0));
			return true;
		},
	};
	// A real process starts after fork returned and the host attached its listeners.
	const boot = () => serve({
		post: (message) => child.emit("message", message),
		onMessage: (listener) => {
			toChild.on("message", listener);
			return () => {
				toChild.off("message", listener);
			};
		},
		onClose: (listener) => {
			child.on("exit", listener);
			return () => {
				child.off("exit", listener);
			};
		},
	});
	const api: UtilityProcessApi = {
		fork: () => {
			setImmediate(() => void boot());
			return fake;
		},
	};
	return { api, state, exit };
};
type MiniCutServerMessage = MediaRpcServerMessage;
type MiniCutClientMessage = MediaRpcClientMessage;

describe("startMediaServiceProcess", () => {
	const disposers: Array<() => Promise<void>> = [];
	afterEach(async () => {
		for (const dispose of disposers.splice(0)) await dispose();
	});

	it("is ready once the service reports ready and serves calls", async () => {
		const jobs: MediaJobController<FileArtifact>[] = [];
		const utility = createFakeUtility((endpoint) => {
			serveMediaService({
				endpoint,
				createService: () =>
					({
						probe: async () => ({ formatName: "ok" }),
						capabilities: async () => ({ ffmpegVersion: "x" }),
						exportPlan: (request: { requestId: string }) => {
							const job = new MediaJobController<FileArtifact>(request.requestId);
							jobs.push(job);
							return job;
						},
						generateProxy: (request: { requestId: string }) => new MediaJobController<FileArtifact>(request.requestId),
					}) as unknown as MediaService,
				fingerprint: async () => ({ fingerprint: "f", version: "v" }),
			});
			endpoint.post({ type: "ready" });
		});
		const process = await startMediaServiceProcess({
			utilityProcess: utility.api,
			entryPath: "media.mjs",
			assets: noAssets,
		});
		disposers.push(() => process.dispose());
		await expect(process.service.capabilities()).resolves.toEqual({ ffmpegVersion: "x" });
	});

	it("rejects with the typed error when the binaries are missing", async () => {
		const utility = createFakeUtility(async (endpoint) => {
			await runMediaServiceProcess({
				endpoint,
				binaries: { ffmpegPath: "minicut-no-such-ffmpeg", ffprobePath: "minicut-no-such-ffprobe" },
			});
		});
		const started = startMediaServiceProcess({
			utilityProcess: utility.api,
			entryPath: "media.mjs",
			assets: noAssets,
		});
		await expect(started).rejects.toBeInstanceOf(MediaServiceStartError);
		await expect(started).rejects.toMatchObject({ info: { code: "binary-not-found" } });
		expect(utility.state.killed).toBe(1);
	});

	it("rejects when the process exits before it is ready", async () => {
		const utility = createFakeUtility(() => undefined);
		const started = startMediaServiceProcess({
			utilityProcess: utility.api,
			entryPath: "media.mjs",
			assets: noAssets,
		});
		utility.exit(1);
		await expect(started).rejects.toThrow(/exited before it was ready \(code 1\)/);
	});

	it("fails running jobs and reports the exit when the process dies", async () => {
		const exits: number[] = [];
		const utility = createFakeUtility((endpoint) => {
			serveMediaService({
				endpoint,
				createService: () =>
					({
						exportPlan: (request: { requestId: string }) => new MediaJobController<FileArtifact>(request.requestId),
					}) as unknown as MediaService,
				fingerprint: async () => ({ fingerprint: "f", version: "v" }),
			});
			endpoint.post({ type: "ready" });
		});
		const process = await startMediaServiceProcess({
			utilityProcess: utility.api,
			entryPath: "media.mjs",
			assets: noAssets,
			onExit: (code) => exits.push(code),
		});
		const job = process.service.exportPlan({ requestId: "e", outputPath: "/o.webm" } as never);
		utility.exit(9);
		await expect(job.outcome).resolves.toMatchObject({
			status: "error",
			error: { details: { reason: "service-stopped" } },
		});
		expect(exits).toEqual([9]);
		await process.dispose();
	});

	it("cancels running jobs before it ends the process", async () => {
		const order: string[] = [];
		const utility = createFakeUtility((endpoint) => {
			serveMediaService({
				endpoint,
				createService: () =>
					({
						exportPlan: (request: { requestId: string }) => {
							const job = new MediaJobController<FileArtifact>(request.requestId);
							job.setCancelHandler(() => {
								order.push("cancel");
								job.cancelled();
							});
							return job;
						},
					}) as unknown as MediaService,
				fingerprint: async () => ({ fingerprint: "f", version: "v" }),
			});
			endpoint.post({ type: "ready" });
		});
		const exits: number[] = [];
		const process = await startMediaServiceProcess({
			utilityProcess: utility.api,
			entryPath: "media.mjs",
			assets: noAssets,
			onExit: (code) => exits.push(code),
		});
		const job = process.service.exportPlan({ requestId: "e", outputPath: "/o.webm" } as never);
		await process.dispose();
		order.push(`killed:${utility.state.killed}`);
		// The exit the host asked for is not reported as a crash.
		expect(exits).toEqual([]);
		expect(await job.outcome).toEqual({ status: "cancelled" });
		expect(order).toEqual(["cancel", "killed:1"]);
	});
});
